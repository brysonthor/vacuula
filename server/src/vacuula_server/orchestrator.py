from __future__ import annotations

import base64
import json
import logging
import threading
import time
import uuid
import zlib
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw
from sqlalchemy import delete, select, update

from vacuula_server.conn import Gen2Gen3Conn
from vacuula_server.constants import MAPS_DIR
from vacuula_server.db import get_session
from vacuula_server.fork_db import (
    clear_schedule_skip,
    get_schedule_skip,
    list_all_schedule_skips,
    list_server_schedules,
    mark_server_schedule_triggered,
    set_schedule_skip,
    upsert_robot_telemetry,
)
from vacuula_server.gen3.commands import build_command, send_chunk
from vacuula_server.gen4.handlers import robot_send_request
from vacuula_server.generation import Generation
from vacuula_server.handlers.events import broadcast
from vacuula_server.models.persistent_map import Boundary, FloorPlan
from vacuula_server.server_tz import server_timezone
from vacuula_server.state import (
    PendingRequest,
    pending_requests,
    register_state_listener,
    robot_connections,
)

logger = logging.getLogger(__name__)

_orch_lock = threading.Lock()
_gen3_queues: dict[str, dict[str, Any]] = {}
_ephemeral_cleanups: dict[str, dict[str, Any]] = {}
_scheduler_started = False

WEEKDAY_NAMES = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]
DAY_TOKEN_TO_WEEKDAY = {
    "mon": 0, "monday": 0,
    "tue": 1, "tuesday": 1,
    "wed": 2, "wednesday": 2,
    "thu": 3, "thursday": 3,
    "fri": 4, "friday": 4,
    "sat": 5, "saturday": 5,
    "sun": 6, "sunday": 6,
}
# Neato Gen 3 day index: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
GEN3_DAY_INDEX_TO_WEEKDAY = {
    0: 6,  # Sun -> Python weekday 6
    1: 0,
    2: 1,
    3: 2,
    4: 3,
    5: 4,
    6: 5,
}


def send_robot_command_sync(
    serial: str,
    payload: dict[str, Any],
    timeout_s: float = 30.0,
) -> tuple[int, Any]:
    """Send a command to a connected Gen 3 or Gen 4 robot and await JSON response."""
    conn = robot_connections.get(serial)
    if conn is None:
        return 400, {"error": "Robot not connected"}

    slot = PendingRequest()
    if conn.gen == Generation.GEN4:
        req_id, err = robot_send_request(conn, payload, slot)
        if err or req_id is None:
            return 502, {"error": "Failed to send command to robot"}
        key = str(req_id)
    elif conn.gen == Generation.GEN3 and isinstance(conn.conn, Gen2Gen3Conn):
        req_id, msg = build_command(serial, payload)
        key = str(req_id)
        pending_requests[key] = slot
        try:
            send_chunk(conn.conn.wfile, msg)
        except Exception as e:
            pending_requests.pop(key, None)
            return 502, {"error": f"Failed to send command: {e}"}
    else:
        return 400, {"error": "Unsupported robot generation"}

    slot.event.wait(timeout_s)
    pending_requests.pop(key, None)
    if not slot.event.is_set():
        return 504, {"error": "Robot did not answer in time"}

    content = slot.content
    if isinstance(content, (bytes, bytearray)):
        with suppress(Exception):
            content = json.loads(content.decode("utf-8"))
    elif isinstance(content, str):
        with suppress(Exception):
            content = json.loads(content)

    return int(slot.status or 200), content


def refresh_gen3_telemetry_async(serial: str) -> None:
    """Fetch getGeneralInfo and getLocalStats in the background for a Gen 3 robot."""

    def _worker() -> None:
        time.sleep(1.0)
        if serial not in robot_connections:
            return
        status_info, resp_info = send_robot_command_sync(serial, {"cmd": "getGeneralInfo"}, timeout_s=12.0)
        info_data = None
        model = None
        firmware = None
        if status_info == 200 and isinstance(resp_info, dict):
            info_data = resp_info.get("data") if isinstance(resp_info.get("data"), dict) else resp_info
            if isinstance(info_data, dict):
                model = info_data.get("model") or (resp_info.get("meta") or {}).get("modelName")
                firmware = info_data.get("firmware") or (resp_info.get("meta") or {}).get("firmware")

        status_stats, resp_stats = send_robot_command_sync(serial, {"cmd": "getLocalStats"}, timeout_s=12.0)
        stats_data = None
        if status_stats == 200 and isinstance(resp_stats, dict):
            stats_data = resp_stats.get("data") if isinstance(resp_stats.get("data"), dict) else resp_stats

        if info_data or stats_data or model or firmware:
            upsert_robot_telemetry(
                serial,
                model=model,
                firmware=firmware,
                info_json=info_data if isinstance(info_data, dict) else None,
                stats_json=stats_data if isinstance(stats_data, dict) else None,
                touch_seen=True,
            )

    threading.Thread(target=_worker, daemon=True, name=f"gen3-telemetry-{serial}").start()


# ---------------------------------------------------------------------------
# Gen 4 Promote with Automatic Schedule Snapshot & Restore
# ---------------------------------------------------------------------------

def snapshot_gen4_schedules(serial: str) -> dict[str, Any] | None:
    status, resp = send_robot_command_sync(serial, {"ability": "scheduling.show"}, timeout_s=12.0)
    if status != 200 or not isinstance(resp, dict):
        return None
    body = resp.get("body")
    if isinstance(body, dict) and isinstance(body.get("events"), list):
        return body
    return None


def restore_gen4_schedules(
    serial: str,
    snapshot: dict[str, Any] | None,
    promoted_map_id: str,
    valid_track_ids: set[str] | None = None,
) -> bool:
    if not snapshot or not isinstance(snapshot.get("events"), list):
        return False
    raw_events = snapshot.get("events") or []
    if not raw_events:
        return True

    restored_count = 0
    for ev in raw_events:
        if not isinstance(ev, dict):
            continue
        cmd = ev.get("command")
        if not isinstance(cmd, dict):
            continue
        runs = cmd.get("runs") or []
        valid_runs: list[dict[str, Any]] = []
        for r in runs:
            if not isinstance(r, dict):
                continue
            rmap = r.get("map")
            if rmap is None:
                valid_runs.append(r)
                continue
            if not isinstance(rmap, dict):
                continue
            tid = rmap.get("track_id")
            if tid and valid_track_ids is not None and tid not in valid_track_ids:
                continue
            valid_runs.append({
                "settings": r.get("settings") or {"mode": "eco", "navigation_mode": "normal"},
                "map": {
                    "rank_id": promoted_map_id,
                    "track_id": tid,
                    "nogo_enabled": bool(rmap.get("nogo_enabled", True)),
                },
            })

        if not valid_runs:
            # If every zone in this scheduled event was deleted, delete the stale event if it has an id
            if ev.get("id"):
                send_robot_command_sync(serial, {"ability": "scheduling.delete", "id": ev["id"]}, timeout_s=10.0)
            continue

        updated_event: dict[str, Any] = {
            **({"id": ev["id"]} if ev.get("id") else {}),
            "enabled": bool(ev.get("enabled", True)),
            "days": list(ev.get("days") or []),
            "time": str(ev.get("time") or "09:00"),
            "command": {
                "ability": cmd.get("ability") or "cleaning.start",
                "auto_localization": bool(cmd.get("auto_localization", False)),
                "force_floorplan": bool(cmd.get("force_floorplan", False)),
                "runs": valid_runs,
            },
        }
        status, _ = send_robot_command_sync(
            serial,
            {"ability": "scheduling.update", "event": updated_event},
            timeout_s=12.0,
        )
        if status == 200:
            restored_count += 1

    if restored_count > 0:
        logger.info("Restored %d Gen 4 schedule event(s) on %s after floorplan promote", restored_count, serial)
    return restored_count > 0


def promote_gen4_floorplan(
    serial: str,
    map_id: str,
    *,
    preserve_schedules: bool = True,
) -> tuple[int, dict[str, Any]]:
    """Promote a Gen 4 floorplan to the robot while preserving native schedules."""
    from vacuula_server.gen4.app import (
        BG_PIXEL,
        FG_PIXEL,
        LINE_WIDTH_PX,
        _build_pgm_bytes,
        _mark_targets_inside_zones,
        demote_floorplan,
    )

    if serial not in robot_connections:
        return 400, {"error": "Robot not connected"}

    schedule_snapshot = snapshot_gen4_schedules(serial) if preserve_schedules else None

    with get_session() as session:
        floorplan = session.execute(select(FloorPlan).where(FloorPlan.id == map_id)).scalar_one_or_none()
        if floorplan is None or floorplan.robot != serial:
            return 404, {"error": "Map not found"}

        boundaries = session.execute(
            select(Boundary).where(Boundary.floorplan == map_id, Boundary.enabled == True)
        ).scalars().all()

        promoted_map_id = session.scalar(
            select(FloorPlan.id).where(FloorPlan.robot == serial, FloorPlan.promoted.is_(True))
        )

    if promoted_map_id is not None:
        ok, msg = demote_floorplan(serial, promoted_map_id)
        if not ok:
            return 400, {"error": msg}

    cleaning_zones = [b for b in boundaries if b.function == "cleaning"]
    nogo_zones = [b for b in boundaries if b.function == "nogo"]

    nogo_img = Image.new("L", floorplan.imgsize, BG_PIXEL)
    nogo_draw = ImageDraw.Draw(nogo_img)
    for boundary in nogo_zones:
        pts = [(p[0] * floorplan.imgsize[0], p[1] * floorplan.imgsize[1]) for p in boundary.vertices]
        if boundary.type == "polyline":
            nogo_draw.line(pts, fill=FG_PIXEL, width=LINE_WIDTH_PX, joint="curve")
        elif boundary.type == "polygon":
            nogo_draw.polygon(pts, fill=FG_PIXEL, outline=FG_PIXEL)
    nogo_raw = _build_pgm_bytes(nogo_img, floorplan)

    cleaning_tracks = []
    valid_track_ids: set[str] = set()
    for boundary in cleaning_zones:
        clean_img = Image.new("L", floorplan.imgsize, BG_PIXEL)
        clean_draw = ImageDraw.Draw(clean_img)
        pts = [(p[0] * floorplan.imgsize[0], p[1] * floorplan.imgsize[1]) for p in boundary.vertices]
        if boundary.type == "polyline":
            clean_draw.line(pts, fill=FG_PIXEL, width=LINE_WIDTH_PX, joint="curve")
        elif boundary.type == "polygon":
            clean_draw.polygon(pts, fill=FG_PIXEL, outline=FG_PIXEL)
        clean_raw = _build_pgm_bytes(clean_img, floorplan)
        cleaning_tracks.append({
            "track_uuid": boundary.id,
            "binary": base64.b64encode(zlib.compress(clean_raw, level=9)).decode("ascii"),
        })
        if not boundary.id.startswith("clean-here-"):
            valid_track_ids.add(boundary.id)

    map_dir = MAPS_DIR / serial / str(map_id)
    try:
        with open(map_dir / "rank_binary.pgm.nz", "rb") as rank, open(map_dir / "real_binary.pgm.nz", "rb") as real:
            real_binary_patched = _mark_targets_inside_zones(real.read(), cleaning_zones, floorplan)
            payload = {
                "ability": "maps.promote_floorplan",
                "rank_uuid": floorplan.id,
                "rank_binary": base64.b64encode(rank.read()).decode("ascii"),
                "real_binary": base64.b64encode(real_binary_patched).decode("ascii"),
                "old_rank_uuid": None,
                "base": {
                    "x": floorplan.base[0],
                    "y": floorplan.base[1],
                    "dir": floorplan.base[2],
                },
                "date_created": floorplan.created_at,
                "nogo_track": {
                    "track_uuid": "a5730f32-3214-4fa8-bfc4-92ca4f83abcf",
                    "binary": base64.b64encode(zlib.compress(nogo_raw, level=9)).decode("ascii"),
                },
                "cleaning_tracks": cleaning_tracks,
            }
    except OSError as e:
        return 500, {"error": f"Failed to read floorplan binaries: {e}"}

    status, resp = send_robot_command_sync(serial, payload, timeout_s=60.0)
    if status != 200:
        err_msg = resp.get("error") if isinstance(resp, dict) else f"Robot rejected promote (status {status})"
        return status, {"error": err_msg or f"Robot rejected promote (status {status})"}

    with get_session() as session:
        floor_plan = session.get(FloorPlan, map_id)
        if floor_plan is None:
            return 404, {"error": "Map not found"}
        session.execute(
            update(FloorPlan)
            .where(FloorPlan.robot == floor_plan.robot, FloorPlan.id != map_id)
            .values(promoted=False)
        )
        floor_plan.promoted = True
        session.commit()

    schedules_restored = False
    if preserve_schedules and schedule_snapshot:
        schedules_restored = restore_gen4_schedules(serial, schedule_snapshot, map_id, valid_track_ids)

    return 200, {
        "promoted": True,
        "rank_uuid": map_id,
        "schedules_restored": schedules_restored,
    }


# ---------------------------------------------------------------------------
# Gen 3 Multi-Zone Queue Orchestrator
# ---------------------------------------------------------------------------

def _public_queue_dict(q: dict[str, Any] | None) -> dict[str, Any] | None:
    if not q:
        return None
    return {
        "id": q["id"],
        "serial": q["serial"],
        "zones": q["zones"],
        "current_index": q["current_index"],
        "status": q["status"],
        "total": len(q["zones"]),
    }


def _broadcast_queue(serial: str) -> None:
    with _orch_lock:
        pub = _public_queue_dict(_gen3_queues.get(serial))
    with suppress(Exception):
        broadcast("queue", {"serial": serial, "queue": pub})


def get_gen3_zone_queue(serial: str) -> dict[str, Any] | None:
    with _orch_lock:
        return _public_queue_dict(_gen3_queues.get(serial))


def _dispatch_gen3_zone(serial: str, zone: dict[str, Any]) -> tuple[bool, str]:
    params = {
        "category": 4,
        "mode": int(zone.get("mode", 2)),
        "modifier": int(zone.get("modifier", 1)),
        "navigationMode": int(zone.get("navigationMode", 1)),
        "boundaryId": str(zone["id"]),
    }
    status, resp = send_robot_command_sync(serial, {"cmd": "startCleaning", "params": params}, timeout_s=20.0)
    if status == 200 and isinstance(resp, dict) and resp.get("result") == "ok":
        return True, ""
    err = resp.get("error") if isinstance(resp, dict) else f"HTTP {status}"
    return False, str(err or "Failed to start zone")


def start_gen3_zone_queue(
    serial: str,
    zones: list[dict[str, Any]],
    *,
    default_mode: int = 2,
    default_modifier: int = 1,
    default_nav_mode: int = 1,
) -> tuple[int, dict[str, Any]]:
    if not zones:
        return 400, {"error": "At least one zone is required"}
    if serial not in robot_connections:
        return 400, {"error": "Robot not connected"}

    normalized_zones = [
        {
            "id": str(z["id"]),
            "name": str(z.get("name") or f"Zone {idx + 1}"),
            "mode": int(z.get("mode", default_mode)),
            "modifier": int(z.get("modifier", default_modifier)),
            "navigationMode": int(z.get("navigationMode", default_nav_mode)),
        }
        for idx, z in enumerate(zones)
        if z.get("id")
    ]
    if not normalized_zones:
        return 400, {"error": "Invalid zone list"}

    ok, err = _dispatch_gen3_zone(serial, normalized_zones[0])
    if not ok:
        return 502, {"error": f"Failed to start first zone: {err}"}

    if len(normalized_zones) == 1:
        return 200, {"started": True, "queue": None}

    q_obj = {
        "id": str(uuid.uuid4()),
        "serial": serial,
        "zones": normalized_zones,
        "current_index": 0,
        "status": "running",
        "saw_busy": False,
        "dispatched_at": time.monotonic(),
        "advancing": False,
    }
    with _orch_lock:
        _gen3_queues[serial] = q_obj
    _broadcast_queue(serial)
    return 200, {"started": True, "queue": _public_queue_dict(q_obj)}


def cancel_gen3_zone_queue(serial: str, stop_robot: bool = False) -> dict[str, Any]:
    with _orch_lock:
        existed = _gen3_queues.pop(serial, None) is not None
    if stop_robot and serial in robot_connections:
        send_robot_command_sync(serial, {"cmd": "stopCleaning"}, timeout_s=10.0)
    _broadcast_queue(serial)
    return {"cancelled": existed}


def _advance_gen3_queue_worker(serial: str, queue_id: str, next_idx: int) -> None:
    # Give the robot a few seconds on dock after completing the previous zone
    time.sleep(5.0)
    with _orch_lock:
        q = _gen3_queues.get(serial)
        if not q or q["id"] != queue_id or q["status"] == "cancelled":
            return
        zone = q["zones"][next_idx]

    logger.info("Dispatching queued Gen 3 zone %d/%d (%s) on %s", next_idx + 1, len(q["zones"]), zone["name"], serial)
    ok, err = _dispatch_gen3_zone(serial, zone)
    with _orch_lock:
        q = _gen3_queues.get(serial)
        if not q or q["id"] != queue_id:
            return
        if ok:
            q["current_index"] = next_idx
            q["status"] = "running"
            q["saw_busy"] = False
            q["dispatched_at"] = time.monotonic()
            q["advancing"] = False
        else:
            logger.warning("Gen 3 queue failed on zone %s for %s: %s", zone["name"], serial, err)
            _gen3_queues.pop(serial, None)
    _broadcast_queue(serial)


# ---------------------------------------------------------------------------
# Ephemeral "Clean Here" (Gen 3 & Gen 4)
# ---------------------------------------------------------------------------


def dock_robot(serial: str) -> tuple[int, dict[str, Any]]:
    """Direct a robot to return to base cleanly, handling any necessary pause transitions,
    state polling, and generation-specific command requirements."""
    if serial not in robot_connections:
        return 400, {"ok": False, "error": "Robot not connected"}

    is_gen3 = "-" in serial

    if is_gen3:
        # Cancel any active multi-zone queue
        cancel_gen3_zone_queue(serial, stop_robot=False)

        st, state = send_robot_command_sync(serial, {"cmd": "getRobotState"}, timeout_s=4.0)
        state_dict = state if (st == 200 and isinstance(state, dict)) else {}
        details = state_dict.get("details") or {}
        cmds = state_dict.get("availableCommands") or {}

        if details.get("isDocked"):
            return 200, {"ok": True, "message": "Robot is already docked", "docking": False, "docked": True}

        if cmds.get("goToBase"):
            st_b, resp_b = send_robot_command_sync(serial, {"cmd": "sendToBase"}, timeout_s=10.0)
            if st_b == 200 and isinstance(resp_b, dict) and resp_b.get("result") == "ok":
                return 200, {"ok": True, "message": "Returning to base", "docking": True, "docked": False}
            return 502, {"ok": False, "error": f"Failed to return to base: {resp_b}"}

        if cmds.get("pause"):
            logger.info("Pausing Gen 3 robot %s before sending to base", serial)
            st_p, resp_p = send_robot_command_sync(serial, {"cmd": "pauseCleaning"}, timeout_s=10.0)
            if st_p != 200 or (isinstance(resp_p, dict) and resp_p.get("result") != "ok"):
                return 502, {"ok": False, "error": f"Failed to pause cleaning: {resp_p}"}

            deadline = time.time() + 15.0
            while time.time() < deadline:
                time.sleep(0.6)
                st_cur, r_cur = send_robot_command_sync(serial, {"cmd": "getRobotState"}, timeout_s=3.0)
                if st_cur == 200 and isinstance(r_cur, dict):
                    cur_cmds = r_cur.get("availableCommands") or {}
                    if cur_cmds.get("goToBase"):
                        st_b, resp_b = send_robot_command_sync(serial, {"cmd": "sendToBase"}, timeout_s=10.0)
                        if st_b == 200 and isinstance(resp_b, dict) and resp_b.get("result") == "ok":
                            return 200, {"ok": True, "message": "Returning to base", "docking": True, "docked": False}
                        return 502, {"ok": False, "error": f"Failed to return to base: {resp_b}"}

                    cur_details = r_cur.get("details") or {}
                    cur_clean = r_cur.get("cleaning") or {}
                    if cur_clean.get("category") == 3 or (cur_details.get("dockHasBeenSeen") is False and r_cur.get("state") == 3):
                        send_robot_command_sync(serial, {"cmd": "stopCleaning"}, timeout_s=5.0)
                        return 200, {
                            "ok": True,
                            "message": "Robot stopped. (Cannot return to base: no dock reference available for this run)",
                            "docking": False,
                            "docked": False,
                        }

            st_b, resp_b = send_robot_command_sync(serial, {"cmd": "sendToBase"}, timeout_s=8.0)
            if st_b == 200 and isinstance(resp_b, dict) and resp_b.get("result") == "ok":
                return 200, {"ok": True, "message": "Returning to base", "docking": True, "docked": False}
            return 400, {"ok": False, "error": "Robot was paused, but could not return to base."}

        st_b, resp_b = send_robot_command_sync(serial, {"cmd": "sendToBase"}, timeout_s=8.0)
        if st_b == 200 and isinstance(resp_b, dict) and resp_b.get("result") == "ok":
            return 200, {"ok": True, "message": "Returning to base", "docking": True, "docked": False}
        return 400, {"ok": False, "error": "Robot cannot return to base in its current state."}

    else:
        # Gen 4
        st, resp = send_robot_command_sync(serial, {"ability": "state.show"}, timeout_s=4.0)
        resp_dict = resp if (st == 200 and isinstance(resp, dict)) else {}
        body = resp_dict.get("body") or resp_dict
        details = body.get("details") or {}
        cmds = body.get("available_commands") or {}

        if details.get("is_docked"):
            return 200, {"ok": True, "message": "Robot is already docked", "docking": False, "docked": True}

        if cmds.get("return_to_base"):
            st_b, resp_b = send_robot_command_sync(serial, {"ability": "navigation.return_to_base"}, timeout_s=10.0)
            if st_b == 200:
                return 200, {"ok": True, "message": "Returning to base", "docking": True, "docked": False}
            return 502, {"ok": False, "error": f"Failed to return to base: {resp_b}"}

        if cmds.get("pause"):
            logger.info("Pausing Gen 4 robot %s before sending to base", serial)
            st_p, resp_p = send_robot_command_sync(serial, {"ability": "cleaning.pause"}, timeout_s=10.0)
            if st_p != 200:
                return 502, {"ok": False, "error": f"Failed to pause cleaning: {resp_p}"}

            deadline = time.time() + 15.0
            while time.time() < deadline:
                time.sleep(0.6)
                st_cur, r_cur = send_robot_command_sync(serial, {"ability": "state.show"}, timeout_s=3.0)
                if st_cur == 200 and isinstance(r_cur, dict):
                    cur_body = r_cur.get("body") or r_cur
                    cur_cmds = cur_body.get("available_commands") or {}
                    if cur_cmds.get("return_to_base"):
                        st_b, resp_b = send_robot_command_sync(serial, {"ability": "navigation.return_to_base"}, timeout_s=10.0)
                        if st_b == 200:
                            return 200, {"ok": True, "message": "Returning to base", "docking": True, "docked": False}
                        return 502, {"ok": False, "error": f"Failed to command robot to return to base: {resp_b}"}

            st_b, resp_b = send_robot_command_sync(serial, {"ability": "navigation.return_to_base"}, timeout_s=8.0)
            if st_b == 200:
                return 200, {"ok": True, "message": "Returning to base", "docking": True, "docked": False}
            return 400, {"ok": False, "error": "Robot was paused, but was not ready to return to base."}

        st_b, resp_b = send_robot_command_sync(serial, {"ability": "navigation.return_to_base"}, timeout_s=8.0)
        if st_b == 200:
            return 200, {"ok": True, "message": "Returning to base", "docking": True, "docked": False}
        return 400, {"ok": False, "error": "Robot cannot return to base in its current state."}

def start_clean_here(serial: str, data: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Create a temporary polygon zone, clean it immediately, and auto-remove afterward."""
    if serial not in robot_connections:
        return 400, {"error": "Robot not connected"}

    map_id = str(data.get("map_id") or "")
    vertices = data.get("vertices")
    if not map_id or not isinstance(vertices, list) or len(vertices) < 3:
        return 400, {"error": "map_id and at least 3 polygon vertices are required"}

    norm_vertices: list[list[float]] = []
    for pt in vertices:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            return 400, {"error": "Invalid vertex format"}
        x = max(0.0, min(1.0, float(pt[0])))
        y = max(0.0, min(1.0, float(pt[1])))
        norm_vertices.append([x, y])

    is_gen3 = "-" in serial
    if is_gen3:
        st, resp = send_robot_command_sync(
            serial,
            {"cmd": "getMapBoundaries", "params": {"mapId": map_id}},
            timeout_s=15.0,
        )
        if st != 200 or not isinstance(resp, dict) or resp.get("result") != "ok":
            return 502, {"error": "Could not read existing map boundaries from robot"}

        existing = list((resp.get("data") or {}).get("boundaries") or [])
        cleaned_existing = [
            b for b in existing
            if isinstance(b, dict) and b.get("name") != "__vacuula_clean_here__"
        ]
        # Calculate relevancy (centroid) for polygons which Gen 3 firmware requires
        def _calc_relevancy(v_list: list[list[float]]) -> list[float]:
            if not v_list:
                return [0.0, 0.0]
            cx = sum(p[0] for p in v_list) / len(v_list)
            cy = sum(p[1] for p in v_list) / len(v_list)
            return [round(cx, 4), round(cy, 4)]

        # Serialize existing boundaries in the format setMapBoundaries expects, preserving IDs & relevancy
        payload_boundaries = []
        for b in cleaned_existing:
            b_type = b.get("type", "polygon")
            b_verts = b.get("vertices", [])
            item: dict[str, Any] = {
                "id": b.get("id") or str(uuid.uuid4()),
                "type": b_type,
                "vertices": b_verts,
                "name": b.get("name", ""),
                "color": b.get("color", "#00E5A3"),
                "enabled": bool(b.get("enabled", True)),
            }
            if b_type == "polygon":
                item["relevancy"] = b.get("relevancy") or _calc_relevancy(b_verts)
            payload_boundaries.append(item)

        target_id = str(uuid.uuid4())
        payload_boundaries.append({
            "id": target_id,
            "type": "polygon",
            "vertices": norm_vertices,
            "relevancy": _calc_relevancy(norm_vertices),
            "name": "__vacuula_clean_here__",
            "color": "#00E5A3",
            "enabled": True,
        })

        st_set, resp_set = send_robot_command_sync(
            serial,
            {"cmd": "setMapBoundaries", "params": {"mapId": map_id, "boundaries": payload_boundaries}},
            timeout_s=20.0,
        )
        if st_set != 200 or (isinstance(resp_set, dict) and resp_set.get("result") != "ok"):
            err_msg = (resp_set.get("result") or resp_set.get("error")) if isinstance(resp_set, dict) else f"HTTP {st_set}"
            logger.error(f"Failed to save temporary zone on {serial}: status={st_set} resp={resp_set}")
            return 502, {"error": f"Failed to save temporary zone on robot ({err_msg})"}

        # Retrieve assigned boundary ID
        assigned_boundaries = (resp_set.get("data") or {}).get("boundaries") if isinstance(resp_set, dict) else None
        if not assigned_boundaries:
            _, resp_get2 = send_robot_command_sync(
                serial,
                {"cmd": "getMapBoundaries", "params": {"mapId": map_id}},
                timeout_s=15.0,
            )
            assigned_boundaries = ((resp_get2 or {}).get("data") or {}).get("boundaries") or []

        found_id = None
        for b in assigned_boundaries or []:
            if isinstance(b, dict) and b.get("name") == "__vacuula_clean_here__" and b.get("id"):
                found_id = b["id"]
                break

        if found_id:
            target_id = found_id

        clean_params = {
            "category": 4,
            "mode": int(data.get("mode", 2)),
            "modifier": int(data.get("modifier", 1)),
            "navigationMode": int(data.get("navigation_mode", 1)),
            "boundaryId": target_id,
        }
        st_start, resp_start = send_robot_command_sync(
            serial,
            {"cmd": "startCleaning", "params": clean_params},
            timeout_s=20.0,
        )
        if st_start != 200 or (isinstance(resp_start, dict) and resp_start.get("result") != "ok"):
            err_msg = (resp_start.get("result") or resp_start.get("error")) if isinstance(resp_start, dict) else f"HTTP {st_start}"
            logger.error(f"Robot {serial} rejected startCleaning: status={st_start} resp={resp_start}")
            # Clean up immediately on failure
            _cleanup_gen3_ephemeral(serial, map_id)
            if err_msg == "not_on_charge_base":
                return 400, {"error": "Robot must be on its charge base to start zone cleaning"}
            return 502, {"error": f"Robot rejected Clean Here command ({err_msg})"}

        with _orch_lock:
            _ephemeral_cleanups[serial] = {
                "gen": "gen3",
                "map_id": map_id,
                "saw_busy": False,
                "started_at": time.monotonic(),
            }
        return 200, {"started": True, "boundary_id": target_id}

    # Gen 4 Clean Here
    temp_id = f"clean-here-{uuid.uuid4().hex[:12]}"
    with get_session() as session:
        # Remove any stale clean-here boundaries first
        session.execute(
            delete(Boundary).where(Boundary.floorplan == map_id, Boundary.id.like("clean-here-%"))
        )
        session.add(
            Boundary(
                id=temp_id,
                floorplan=map_id,
                name="Clean Here",
                color="#00E5A3",
                type="polygon",
                vertices=norm_vertices,
                enabled=True,
                function="cleaning",
            )
        )
        session.commit()

    prom_status, prom_resp = promote_gen4_floorplan(serial, map_id, preserve_schedules=True)
    if prom_status != 200:
        with get_session() as session:
            session.execute(delete(Boundary).where(Boundary.id == temp_id))
            session.commit()
        return prom_status, prom_resp

    suction_mode = str(data.get("suction_mode") or data.get("mode") or "eco")
    nav_mode = str(data.get("navigation_mode") or "normal")
    nogo_enabled = bool(data.get("nogo_enabled", True))
    start_payload = {
        "ability": "cleaning.start",
        "runs": [
            {
                "map": {
                    "rank_id": map_id,
                    "track_id": temp_id,
                    "nogo_enabled": nogo_enabled,
                },
                "settings": {
                    "mode": suction_mode,
                    "navigation_mode": nav_mode,
                },
            }
        ],
    }
    st_start, resp_start = send_robot_command_sync(serial, start_payload, timeout_s=20.0)

    # Remove ephemeral boundary from DB right away so Map Studio stays clean
    with get_session() as session:
        session.execute(delete(Boundary).where(Boundary.id == temp_id))
        session.commit()

    if st_start != 200:
        err_msg = (resp_start.get("error") or resp_start.get("message")) if isinstance(resp_start, dict) else f"HTTP {st_start}"
        logger.error(f"Robot {serial} failed to start Gen 4 Clean Here: status={st_start} resp={resp_start}")
        return st_start, {"error": f"Robot failed to start Clean Here ({err_msg})"}

    with _orch_lock:
        _ephemeral_cleanups[serial] = {
            "gen": "gen4",
            "map_id": map_id,
            "saw_busy": False,
            "started_at": time.monotonic(),
        }

    return 200, {"started": True, "boundary_id": temp_id}


def _cleanup_gen3_ephemeral(serial: str, map_id: str) -> None:
    st, resp = send_robot_command_sync(
        serial,
        {"cmd": "getMapBoundaries", "params": {"mapId": map_id}},
        timeout_s=15.0,
    )
    if st != 200 or not isinstance(resp, dict):
        return
    boundaries = (resp.get("data") or {}).get("boundaries") or []
    def _calc_relevancy(v_list: list[list[float]]) -> list[float]:
        if not v_list:
            return [0.0, 0.0]
        cx = sum(p[0] for p in v_list) / len(v_list)
        cy = sum(p[1] for p in v_list) / len(v_list)
        return [round(cx, 4), round(cy, 4)]

    filtered = []
    for b in boundaries:
        if isinstance(b, dict) and b.get("name") != "__vacuula_clean_here__":
            b_type = b.get("type", "polygon")
            b_verts = b.get("vertices", [])
            item: dict[str, Any] = {
                "id": b.get("id") or str(uuid.uuid4()),
                "type": b_type,
                "vertices": b_verts,
                "name": b.get("name", ""),
                "color": b.get("color", "#00E5A3"),
                "enabled": bool(b.get("enabled", True)),
            }
            if b_type == "polygon":
                item["relevancy"] = b.get("relevancy") or _calc_relevancy(b_verts)
            filtered.append(item)

    if len(filtered) != len(boundaries):
        send_robot_command_sync(
            serial,
            {"cmd": "setMapBoundaries", "params": {"mapId": map_id, "boundaries": filtered}},
            timeout_s=15.0,
        )
        logger.info("Removed temporary Clean Here boundary on Gen 3 robot %s", serial)


# ---------------------------------------------------------------------------
# State Transition Listener (drives Gen 3 Queue + Ephemeral Cleanup)
# ---------------------------------------------------------------------------

def _on_robot_state_updated(serial: str, snapshot: dict[str, Any]) -> None:
    is_gen3 = "-" in serial

    # 1. Check Gen 3 Multi-Zone Queue
    if is_gen3:
        advance_args: tuple[str, str, int] | None = None
        cancelled_or_done = False
        with _orch_lock:
            q = _gen3_queues.get(serial)
            if q and not q.get("advancing"):
                raw_state = snapshot.get("state")
                raw_action = snapshot.get("action")
                details = snapshot.get("details") or {}
                if raw_state == 4 or snapshot.get("error"):
                    _gen3_queues.pop(serial, None)
                    cancelled_or_done = True
                elif raw_state == 2 or raw_action in (1, 4, 11):
                    q["saw_busy"] = True
                elif (
                    raw_state == 1
                    and details.get("isDocked")
                    and (q.get("saw_busy") or (time.monotonic() - q["dispatched_at"] > 20.0))
                ):
                    next_idx = q["current_index"] + 1
                    if next_idx < len(q["zones"]):
                        q["advancing"] = True
                        q["status"] = "waiting_dock"
                        advance_args = (serial, q["id"], next_idx)
                    else:
                        _gen3_queues.pop(serial, None)
                        cancelled_or_done = True

        if advance_args:
            _broadcast_queue(serial)
            threading.Thread(
                target=_advance_gen3_queue_worker,
                args=advance_args,
                daemon=True,
            ).start()
        elif cancelled_or_done:
            _broadcast_queue(serial)

    # 2. Check Ephemeral Clean Here Cleanup
    cleanup_entry = None
    with _orch_lock:
        ep = _ephemeral_cleanups.get(serial)
        if ep:
            if is_gen3:
                st = snapshot.get("state")
                act = snapshot.get("action")
                if st == 2 or act in (1, 4, 11):
                    ep["saw_busy"] = True
                elif st in (1, 4) and (ep["saw_busy"] or (time.monotonic() - ep["started_at"] > 25.0)):
                    cleanup_entry = _ephemeral_cleanups.pop(serial, None)
            else:
                st = str(snapshot.get("state") or "").lower()
                act = str(snapshot.get("action") or "").lower()
                details = snapshot.get("details") or {}
                if st == "busy" or act in ("cleaning", "docking"):
                    ep["saw_busy"] = True
                elif st in ("idle", "error") and details.get("is_docked") and (
                    ep["saw_busy"] or (time.monotonic() - ep["started_at"] > 30.0)
                ):
                    cleanup_entry = _ephemeral_cleanups.pop(serial, None)

    if cleanup_entry:
        def _run_cleanup(entry: dict[str, Any]) -> None:
            time.sleep(3.0)
            if entry["gen"] == "gen3":
                _cleanup_gen3_ephemeral(serial, entry["map_id"])
            else:
                promote_gen4_floorplan(serial, entry["map_id"], preserve_schedules=True)

        threading.Thread(target=_run_cleanup, args=(cleanup_entry,), daemon=True).start()


register_state_listener(_on_robot_state_updated)


# ---------------------------------------------------------------------------
# Hybrid Server Scheduler + "Skip Next Run"
# ---------------------------------------------------------------------------

def _compute_next_occurrence(now_local: datetime, weekday_idx: int, hhmm: str) -> datetime | None:
    try:
        hh, mm = [int(p) for p in hhmm.split(":", 1)]
    except Exception:
        return None
    days_ahead = (weekday_idx - now_local.weekday()) % 7
    candidate = now_local.replace(hour=hh, minute=mm, second=0, microsecond=0) + timedelta(days=days_ahead)
    if candidate <= now_local:
        candidate += timedelta(days=7)
    return candidate


def activate_skip_next_run(serial: str, until_iso: str | None = None) -> tuple[int, dict[str, Any]]:
    """Mute the next upcoming scheduled run (native or server) until it passes."""
    tz = ZoneInfo(server_timezone())
    now_local = datetime.now(tz)
    candidates: list[datetime] = []
    native_restore: dict[str, Any] | None = None

    # Check server schedules for this robot
    for s in list_server_schedules(serial):
        if not s.get("enabled"):
            continue
        if s["schedule_type"] == "one_off" and s.get("run_at_iso"):
            with suppress(Exception):
                dt = datetime.fromisoformat(s["run_at_iso"].replace("Z", "+00:00")).astimezone(tz)
                if dt > now_local:
                    candidates.append(dt)
        elif s["schedule_type"] == "recurring":
            for d_name in s.get("days") or []:
                d_lower = str(d_name).lower()
                if d_lower in DAY_TOKEN_TO_WEEKDAY:
                    nxt = _compute_next_occurrence(now_local, DAY_TOKEN_TO_WEEKDAY[d_lower], s.get("time_hhmm", "09:00"))
                    if nxt:
                        candidates.append(nxt)

    # Check & mute native robot schedule if connected
    is_gen3 = "-" in serial
    if serial in robot_connections:
        if is_gen3:
            st, resp = send_robot_command_sync(serial, {"cmd": "getSchedule"}, timeout_s=12.0)
            if st == 200 and isinstance(resp, dict):
                data = resp.get("data") or {}
                if data.get("enabled"):
                    native_restore = {"gen": "gen3", "was_enabled": True}
                    for ev in data.get("events") or []:
                        if isinstance(ev, dict) and ev.get("day") in GEN3_DAY_INDEX_TO_WEEKDAY:
                            w_idx = GEN3_DAY_INDEX_TO_WEEKDAY[ev["day"]]
                            nxt = _compute_next_occurrence(now_local, w_idx, ev.get("startTime", "09:00"))
                            if nxt:
                                candidates.append(nxt)
                    send_robot_command_sync(serial, {"cmd": "disableSchedule"}, timeout_s=10.0)
        else:
            snap = snapshot_gen4_schedules(serial)
            if snap and isinstance(snap.get("events"), list):
                enabled_events = [
                    ev for ev in snap["events"]
                    if isinstance(ev, dict) and ev.get("enabled", True)
                ]
                if enabled_events:
                    native_restore = {"gen": "gen4", "events": enabled_events}
                    for ev in enabled_events:
                        for d_name in ev.get("days") or []:
                            d_lower = str(d_name).lower()
                            if d_lower in DAY_TOKEN_TO_WEEKDAY:
                                nxt = _compute_next_occurrence(now_local, DAY_TOKEN_TO_WEEKDAY[d_lower], ev.get("time", "09:00"))
                                if nxt:
                                    candidates.append(nxt)
                        send_robot_command_sync(
                            serial,
                            {"ability": "scheduling.update", "event": {**ev, "enabled": False}},
                            timeout_s=10.0,
                        )

    if until_iso:
        skip_until = until_iso
    elif candidates:
        earliest = min(candidates)
        skip_until = (earliest + timedelta(minutes=10)).astimezone(timezone.utc).isoformat()
    else:
        skip_until = (now_local + timedelta(hours=24)).astimezone(timezone.utc).isoformat()

    saved = set_schedule_skip(serial, skip_until, native_restore_json=native_restore)
    return 200, saved


def cancel_skip_next_run(serial: str) -> tuple[int, dict[str, Any]]:
    restore = clear_schedule_skip(serial)
    _restore_native_after_skip(serial, restore)
    return 200, {"cleared": True}


def _restore_native_after_skip(serial: str, restore: dict[str, Any] | None) -> None:
    if not restore or serial not in robot_connections:
        return
    if restore.get("gen") == "gen3" and restore.get("was_enabled"):
        send_robot_command_sync(serial, {"cmd": "enableSchedule"}, timeout_s=12.0)
        logger.info("Re-enabled Gen 3 native schedule on %s after skip window", serial)
    elif restore.get("gen") == "gen4" and isinstance(restore.get("events"), list):
        for ev in restore["events"]:
            if isinstance(ev, dict):
                send_robot_command_sync(
                    serial,
                    {"ability": "scheduling.update", "event": {**ev, "enabled": True}},
                    timeout_s=10.0,
                )
        logger.info("Re-enabled Gen 4 native schedule event(s) on %s after skip window", serial)


def _execute_server_schedule(sched: dict[str, Any]) -> None:
    serial = sched["robot"]
    if serial not in robot_connections:
        logger.warning("Skipping due server schedule %s: robot %s is offline", sched["id"], serial)
        return

    payload = sched.get("payload") or {}
    is_gen3 = "-" in serial
    logger.info("Executing server schedule '%s' (%s) on %s", sched.get("name") or sched["id"], sched["schedule_type"], serial)

    if is_gen3:
        zones = payload.get("zones")
        if isinstance(zones, list) and len(zones) > 0:
            start_gen3_zone_queue(
                serial,
                zones,
                default_mode=int(payload.get("mode", 2)),
                default_modifier=int(payload.get("modifier", 1)),
                default_nav_mode=int(payload.get("navigationMode", 1)),
            )
        else:
            params: dict[str, Any] = {
                "category": int(payload.get("category", 4)),
                "mode": int(payload.get("mode", 2)),
                "modifier": int(payload.get("modifier", 1)),
                "navigationMode": int(payload.get("navigationMode", 1)),
            }
            if payload.get("boundaryId"):
                params["boundaryId"] = payload["boundaryId"]
            send_robot_command_sync(serial, {"cmd": "startCleaning", "params": params}, timeout_s=20.0)
    else:
        runs = payload.get("runs")
        if isinstance(runs, list) and len(runs) > 0:
            send_robot_command_sync(
                serial,
                {"ability": "cleaning.start", "runs": runs},
                timeout_s=20.0,
            )


def _scheduler_tick() -> None:
    tz = ZoneInfo(server_timezone())
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(tz)

    # 1. Expire finished ScheduleSkip windows
    active_skips: set[str] = set()
    for sk in list_all_schedule_skips():
        serial = sk["robot"]
        until_str = sk.get("skip_until_iso")
        if not until_str:
            continue
        try:
            until_dt = datetime.fromisoformat(until_str.replace("Z", "+00:00"))
        except Exception:
            continue
        if now_utc >= until_dt:
            # Only clear if robot is connected or there is no native state to restore
            if serial in robot_connections or not sk.get("native_restore_json"):
                restore = clear_schedule_skip(serial)
                _restore_native_after_skip(serial, restore)
        else:
            active_skips.add(serial)

    # 2. Evaluate ServerSchedule rows
    weekday_name = WEEKDAY_NAMES[now_local.weekday()]
    hhmm_now = now_local.strftime("%H:%M")
    trigger_key_now = now_local.strftime("%Y-%m-%d %H:%M")

    for sched in list_server_schedules():
        if not sched.get("enabled"):
            continue
        serial = sched["robot"]

        if sched["schedule_type"] == "one_off":
            run_iso = sched.get("run_at_iso")
            if not run_iso:
                continue
            try:
                target_dt = datetime.fromisoformat(run_iso.replace("Z", "+00:00"))
            except Exception:
                continue
            diff_s = (now_utc - target_dt).total_seconds()
            if 0 <= diff_s <= 1800:
                mark_server_schedule_triggered(sched["id"], trigger_key_now, disable=True)
                if serial not in active_skips:
                    _execute_server_schedule(sched)
            elif diff_s > 1800:
                mark_server_schedule_triggered(sched["id"], "expired", disable=True)

        elif sched["schedule_type"] == "recurring":
            day_indices = {
                DAY_TOKEN_TO_WEEKDAY[str(d).lower()]
                for d in (sched.get("days") or [])
                if str(d).lower() in DAY_TOKEN_TO_WEEKDAY
            }
            if now_local.weekday() in day_indices and sched.get("time_hhmm") == hhmm_now:
                if sched.get("last_triggered_key") != trigger_key_now:
                    mark_server_schedule_triggered(sched["id"], trigger_key_now, disable=False)
                    if serial not in active_skips:
                        _execute_server_schedule(sched)


def _scheduler_loop() -> None:
    while True:
        time.sleep(15.0)
        try:
            _scheduler_tick()
        except Exception as e:
            logger.debug("Scheduler tick error: %s", e)


def start_scheduler_thread() -> None:
    global _scheduler_started
    with _orch_lock:
        if _scheduler_started:
            return
        _scheduler_started = True
    threading.Thread(target=_scheduler_loop, daemon=True, name="vacuula-scheduler").start()
