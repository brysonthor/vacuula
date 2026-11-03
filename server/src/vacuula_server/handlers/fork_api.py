from __future__ import annotations

import logging
import os
import shutil
from contextlib import suppress
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import delete, select

from vacuula_server.constants import MAPS_DIR, UPLOADS_DIR
from vacuula_server.db import get_session
from vacuula_server.discord import send_test_notification
from vacuula_server.fork_db import (
    delete_server_schedule,
    get_consumables_status,
    get_notification_settings,
    get_robot_telemetry,
     get_schedule_skip,
    list_server_schedules,
    purge_fork_robot_data,
    reset_consumable,
    save_notification_settings,
    update_consumable_threshold,
    upsert_robot_telemetry,
    upsert_server_schedule,
)
from vacuula_server.gen3.data import Gen3Data
from vacuula_server.gen4.app import demote_floorplan
from vacuula_server.gen4.data import Gen4Data
from vacuula_server.handlers.events import notify_robots_changed
from vacuula_server.manual_drive import drive_input, drive_start, drive_status, drive_stop
from vacuula_server.models.persistent_map import Boundary, FloorPlan, PersistentMap
from vacuula_server.models.robot import Robot
from vacuula_server.models.run import Gen3__Run, Gen4__Run
from vacuula_server.orchestrator import (
    activate_skip_next_run,
    cancel_gen3_zone_queue,
    cancel_skip_next_run,
    get_gen3_zone_queue,
    send_robot_command_sync,
    start_clean_here,
    start_gen3_zone_queue,
)
from vacuula_server.state import last_known_robot_state, robot_connections

if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Notifications Settings
# ---------------------------------------------------------------------------

def get_notifications(req: "RouterHandler") -> None:
    req.send_ok(get_notification_settings())


def post_notifications(req: "RouterHandler") -> None:
    data = req.read_json()
    if data is None:
        return
    saved = save_notification_settings(data)
    req.send_ok(saved)


def post_notifications_test(req: "RouterHandler") -> None:
    data = req.read_json()
    if data is None:
        return
    override_url = data.get("discord_webhook_url")
    ok, msg = send_test_notification(override_url)
    if ok:
        req.send_ok({"ok": True, "message": msg})
    else:
        req.send_bad_request(msg)


# ---------------------------------------------------------------------------
# Robot Telemetry & Diagnostic Log Archives
# ---------------------------------------------------------------------------

def get_telemetry(req: "RouterHandler", serial: str) -> None:
    refresh = "refresh=true" in req.path
    is_gen3 = "-" in serial
    if refresh and serial in robot_connections:
        if is_gen3:
            st_info, r_info = send_robot_command_sync(serial, {"cmd": "getGeneralInfo"}, timeout_s=10.0)
            st_stats, r_stats = send_robot_command_sync(serial, {"cmd": "getLocalStats"}, timeout_s=10.0)
            info_obj = (r_info.get("data") if isinstance(r_info, dict) else None) or None
            stats_obj = (r_stats.get("data") if isinstance(r_stats, dict) else None) or None
            model = (info_obj or {}).get("model") if isinstance(info_obj, dict) else None
            fw = (info_obj or {}).get("firmware") if isinstance(info_obj, dict) else None
            upsert_robot_telemetry(
                serial,
                model=model,
                firmware=fw,
                info_json=info_obj if (st_info == 200 and isinstance(info_obj, dict)) else None,
                stats_json=stats_obj if (st_stats == 200 and isinstance(stats_obj, dict)) else None,
            )
        else:
            st_info, r_info = send_robot_command_sync(serial, {"ability": "info.robot"}, timeout_s=10.0)
            if st_info == 200 and isinstance(r_info, dict) and isinstance(r_info.get("body"), dict):
                body = r_info["body"]
                upsert_robot_telemetry(
                    serial,
                    model=body.get("model") or body.get("sku"),
                    firmware=body.get("firmware") or body.get("software_version"),
                    info_json=body,
                )

    tel = get_robot_telemetry(serial) or {
        "serial": serial,
        "ip_address": None,
        "model": None,
        "firmware": None,
        "last_seen_at": None,
        "info": {},
        "stats": {},
        "last_state": last_known_robot_state.get(serial) or {},
    }
    tel["online"] = serial in robot_connections
    req.send_ok(tel)


def get_robot_logs(req: "RouterHandler", serial: str) -> None:
    logs_root = UPLOADS_DIR / "logs" / serial
    entries: list[dict] = []
    if logs_root.is_dir():
        for job_dir in sorted(logs_root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not job_dir.is_dir():
                continue
            for file_path in job_dir.iterdir():
                if file_path.is_file():
                    stat = file_path.stat()
                    entries.append({
                        "job_id": job_dir.name,
                        "filename": file_path.name,
                        "size_bytes": stat.st_size,
                        "uploaded_at": stat.st_mtime,
                    })
    req.send_ok(entries)


def download_robot_log(req: "RouterHandler", serial: str, job_id: str, filename: str) -> None:
    root = (UPLOADS_DIR / "logs" / serial).resolve()
    target = (root / job_id / filename).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        req.send_not_found()
        return
    if not target.is_file():
        req.send_not_found("Log archive not found")
        return
    try:
        data = target.read_bytes()
    except OSError:
        req.send_internal_error("Failed to read archive")
        return
    req.download_text(data, target.name, content_type="application/gzip")


# ---------------------------------------------------------------------------
# Consumables Lifespan Tracking
# ---------------------------------------------------------------------------

def get_consumables(req: "RouterHandler", serial: str) -> None:
    req.send_ok(get_consumables_status(serial))


def post_consumable_reset(req: "RouterHandler", serial: str) -> None:
    data = req.read_json()
    if data is None:
        return
    consumable = str(data.get("consumable") or "")
    threshold = data.get("threshold_hours")
    try:
        items = reset_consumable(
            serial,
            consumable,
            float(threshold) if threshold is not None else None,
        )
        req.send_ok(items)
    except ValueError as e:
        req.send_bad_request(str(e))


def post_consumable_threshold(req: "RouterHandler", serial: str) -> None:
    data = req.read_json()
    if data is None:
        return
    consumable = str(data.get("consumable") or "")
    threshold = data.get("threshold_hours")
    if threshold is None:
        req.send_bad_request("threshold_hours is required")
        return
    try:
        items = update_consumable_threshold(serial, consumable, float(threshold))
        req.send_ok(items)
    except ValueError as e:
        req.send_bad_request(str(e))


# ---------------------------------------------------------------------------
# Hybrid Server Schedules & Skip Next Run
# ---------------------------------------------------------------------------

def get_server_schedules(req: "RouterHandler", serial: str) -> None:
    req.send_ok(list_server_schedules(serial))


def post_server_schedule(req: "RouterHandler", serial: str) -> None:
    data = req.read_json()
    if data is None:
        return
    saved = upsert_server_schedule(serial, data)
    req.send_ok(saved)


def delete_server_schedule_handler(req: "RouterHandler", serial: str, sched_id: str) -> None:
    ok = delete_server_schedule(serial, sched_id)
    if not ok:
        req.send_not_found("Schedule not found")
        return
    req.send_ok({"deleted": True})


def get_schedule_skip_handler(req: "RouterHandler", serial: str) -> None:
    req.send_ok(get_schedule_skip(serial) or {"active": False})


def post_schedule_skip_handler(req: "RouterHandler", serial: str) -> None:
    data = req.read_json()
    if data is None:
        return
    status, resp = activate_skip_next_run(serial, until_iso=data.get("skip_until_iso"))
    req.send_response_data({**resp, "active": True}, True, status=status)


def delete_schedule_skip_handler(req: "RouterHandler", serial: str) -> None:
    status, resp = cancel_skip_next_run(serial)
    req.send_response_data({**resp, "active": False}, True, status=status)


# ---------------------------------------------------------------------------
# Multi-Zone Queue & Ephemeral "Clean Here"
# ---------------------------------------------------------------------------

def get_queue_handler(req: "RouterHandler", serial: str) -> None:
    req.send_ok({"queue": get_gen3_zone_queue(serial)})


def post_queue_handler(req: "RouterHandler", serial: str) -> None:
    data = req.read_json()
    if data is None:
        return
    zones = data.get("zones") or []
    status, resp = start_gen3_zone_queue(
        serial,
        zones,
        default_mode=int(data.get("mode", 2)),
        default_modifier=int(data.get("modifier", 1)),
        default_nav_mode=int(data.get("navigationMode", 1)),
    )
    req.send_response_data(resp, True, status=status)


def delete_queue_handler(req: "RouterHandler", serial: str) -> None:
    stop_robot = "stop=true" in req.path
    req.send_ok(cancel_gen3_zone_queue(serial, stop_robot=stop_robot))


def post_clean_here_handler(req: "RouterHandler", serial: str) -> None:
    data = req.read_json()
    if data is None:
        return
    status, resp = start_clean_here(serial, data)
    req.send_response_data(resp, True, status=status)


# ---------------------------------------------------------------------------
# Gen 3 Manual Remote Drive
# ---------------------------------------------------------------------------

def post_drive_start(req: "RouterHandler", serial: str) -> None:
    status, resp = drive_start(serial)
    req.send_response_data(resp, True, status=status)


def post_drive_input(req: "RouterHandler", serial: str) -> None:
    data = req.read_json()
    if data is None:
        return
    status, resp = drive_input(serial, data)
    req.send_response_data(resp, True, status=status)


def post_drive_stop(req: "RouterHandler", serial: str) -> None:
    status, resp = drive_stop(serial)
    req.send_response_data(resp, True, status=status)


def get_drive_status(req: "RouterHandler", serial: str) -> None:
    status, resp = drive_status(serial)
    req.send_response_data(resp, True, status=status)


# ---------------------------------------------------------------------------
# Cleanup Endpoints (Delete Run, Purge Map, Delete Robot)
# ---------------------------------------------------------------------------

def delete_run(req: "RouterHandler", serial: str, run_id: str) -> None:
    is_gen3 = "-" in serial
    can_remove_folder = False

    with get_session() as session:
        if is_gen3:
            run_row = session.get(Gen3__Run, run_id)
            if run_row is None or run_row.robot != serial:
                req.send_not_found("Run not found")
                return
            session.delete(run_row)
            pmap = session.get(PersistentMap, run_id)
            if pmap is not None and not pmap.in_maps_list:
                session.delete(pmap)
                can_remove_folder = True
            elif pmap is None:
                can_remove_folder = True
        else:
            run_row = session.get(Gen4__Run, run_id)
            if run_row is None or run_row.robot != serial:
                req.send_not_found("Run not found")
                return
            session.delete(run_row)
            fp = session.get(FloorPlan, run_id)
            if fp is not None and not fp.in_maps_list and not fp.promoted:
                session.execute(delete(Boundary).where(Boundary.floorplan == run_id))
                session.delete(fp)
                can_remove_folder = True
            elif fp is None:
                can_remove_folder = True
        session.commit()

    folder = MAPS_DIR / serial / str(run_id)
    if can_remove_folder and folder.is_dir():
        with suppress(OSError):
            shutil.rmtree(folder)
    else:
        runmap = folder / "runmap.json"
        if runmap.is_file():
            with suppress(OSError):
                os.remove(runmap)

    req.send_ok({"deleted": True, "id": run_id})


def purge_map(req: "RouterHandler", serial: str, map_id: str) -> None:
    is_gen3 = "-" in serial
    remove_folder = False

    if not is_gen3 and serial in robot_connections:
        with get_session() as session:
            fp = session.get(FloorPlan, map_id)
            if fp and fp.promoted:
                demote_floorplan(serial, map_id)

    with get_session() as session:
        if is_gen3:
            pmap = session.get(PersistentMap, map_id)
            if pmap is None or pmap.robot != serial:
                req.send_not_found("Map not found")
                return
            has_run = session.get(Gen3__Run, map_id) is not None
            if has_run:
                pmap.in_maps_list = False
                pmap.enabled = False
            else:
                session.delete(pmap)
                remove_folder = True
        else:
            fp = session.get(FloorPlan, map_id)
            if fp is None or fp.robot != serial:
                req.send_not_found("Map not found")
                return
            session.execute(delete(Boundary).where(Boundary.floorplan == map_id))
            has_run = session.get(Gen4__Run, map_id) is not None
            if has_run:
                fp.in_maps_list = False
                fp.promoted = False
            else:
                session.delete(fp)
                remove_folder = True
        session.commit()

    if remove_folder:
        folder = MAPS_DIR / serial / str(map_id)
        if folder.is_dir():
            with suppress(OSError):
                shutil.rmtree(folder)

    req.send_ok({"purged": True, "id": map_id})


def delete_robot(req: "RouterHandler", serial: str) -> None:
    cancel_gen3_zone_queue(serial, stop_robot=False)
    drive_stop(serial)

    conn = robot_connections.pop(serial, None)
    if conn is not None:
        conn.stop_event.set()
        with suppress(Exception):
            if hasattr(conn.conn, "socket"):
                conn.conn.socket.close()
            elif hasattr(conn.conn, "wfile"):
                conn.conn.wfile.close()

    last_known_robot_state.pop(serial, None)

    with get_session() as session:
        robot = session.get(Robot, serial)
        if robot is None:
            req.send_not_found("Robot not found")
            return

        fp_ids = session.execute(select(FloorPlan.id).where(FloorPlan.robot == serial)).scalars().all()
        if fp_ids:
            session.execute(delete(Boundary).where(Boundary.floorplan.in_(fp_ids)))

        session.execute(delete(Gen3__Run).where(Gen3__Run.robot == serial))
        session.execute(delete(Gen4__Run).where(Gen4__Run.robot == serial))
        session.execute(delete(PersistentMap).where(PersistentMap.robot == serial))
        session.execute(delete(FloorPlan).where(FloorPlan.robot == serial))
        session.execute(delete(Gen3Data).where(Gen3Data.robot == serial))
        session.execute(delete(Gen4Data).where(Gen4Data.robot == serial))
        session.delete(robot)
        session.commit()

    purge_fork_robot_data(serial)

    for folder in (MAPS_DIR / serial, UPLOADS_DIR / "logs" / serial):
        if Path(folder).is_dir():
            with suppress(OSError):
                shutil.rmtree(folder)

    notify_robots_changed()
    req.send_ok({"deleted": True, "serial": serial})
