from __future__ import annotations
from vacuula_server.conn import RobotConn
from typing import Dict, Any, Callable
import copy
import time
import threading, queue
from contextlib import suppress

# robot_connections: List[RobotConn]  = []
robot_connections: Dict[str, RobotConn] = {}


# client_connection:
# - client id
# - connection itself
client_connections = []


class PendingRequest:
    __slots__ = ("event", "content", "status")

    def __init__(self):
        self.event = threading.Event()
        self.content = None
        self.status = None

    def fulfill(self, content, status):
        self.content = content
        self.status = status
        self.event.set()

# pending_requests:
# - req_id --> PendingRequest
pending_requests: dict[str, PendingRequest] = {}

# Cached last-known state per robot serial
_state_lock = threading.Lock()
last_known_robot_state: dict[str, dict[str, Any]] = {}
_last_db_persist_ts: dict[str, float] = {}
_state_listeners: list[Callable[[str, dict[str, Any]], None]] = []


def register_state_listener(listener: Callable[[str, dict[str, Any]], None]) -> None:
    if listener not in _state_listeners:
        _state_listeners.append(listener)


def _fire_state_listeners(serial: str, snapshot: dict[str, Any]) -> None:
    for fn in list(_state_listeners):
        with suppress(Exception):
            fn(serial, snapshot)


def _maybe_persist_telemetry(
    serial: str,
    cached: dict[str, Any],
    *,
    force: bool = False,
    model: str | None = None,
    firmware: str | None = None,
) -> None:
    now = time.monotonic()
    prev_ts = _last_db_persist_ts.get(serial, 0.0)
    if not force and (now - prev_ts) < 10.0:
        return
    _last_db_persist_ts[serial] = now
    with suppress(Exception):
        from vacuula_server.fork_db import upsert_robot_telemetry

        upsert_robot_telemetry(
            serial,
            model=model,
            firmware=firmware,
            last_state_json=copy.deepcopy(cached),
            touch_seen=True,
        )


def seed_cached_states_from_db() -> None:
    with suppress(Exception):
        from vacuula_server.fork_db import get_all_robot_telemetry

        rows = get_all_robot_telemetry()
        with _state_lock:
            for serial, t in rows.items():
                last_st = t.get("last_state")
                if isinstance(last_st, dict) and last_st and serial not in last_known_robot_state:
                    last_known_robot_state[serial] = copy.deepcopy(last_st)


def update_gen3_state_cache(serial: str, payload: dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        return
    source = payload.get("data") if (isinstance(payload.get("data"), dict) and "state" in payload["data"]) else payload
    if not isinstance(source, dict):
        return

    changed = False
    with _state_lock:
        if serial not in last_known_robot_state:
            last_known_robot_state[serial] = {
                "version": 1,
                "result": "ok",
                "data": {},
                "state": 1,
                "action": 0,
                "error": None,
                "alert": None,
                "cleaning": {
                    "category": 2,
                    "mode": 1,
                    "modifier": 1,
                    "navigationMode": 1,
                    "spotWidth": 0,
                    "spotHeight": 0,
                },
                "details": {
                    "isCharging": False,
                    "isDocked": True,
                    "isScheduleEnabled": True,
                    "dockHasBeenSeen": False,
                    "charge": 100,
                },
                "availableCommands": {
                    "start": True,
                    "stop": False,
                    "pause": False,
                    "resume": False,
                    "goToBase": False,
                },
                "availableServices": {
                    "findMe": "basic-1",
                    "generalInfo": "basic-1",
                    "houseCleaning": "basic-4",
                    "IECTest": "advanced-1",
                    "logCopy": "basic-1",
                    "manualCleaning": "basic-1",
                    "maps": "basic-2",
                    "preferences": "basic-2",
                    "schedule": "basic-2",
                    "softwareUpdate": "basic-1",
                    "spotCleaning": "basic-3",
                    "wifi": "basic-1",
                },
                "meta": {
                    "modelName": "BotVac",
                    "firmware": "2.2.0",
                },
            }
            changed = True

        cached = last_known_robot_state[serial]
        prev_sig = (
            cached.get("state"),
            cached.get("action"),
            cached.get("error"),
            cached.get("alert"),
            (cached.get("details") or {}).get("charge"),
            (cached.get("details") or {}).get("isDocked"),
        )
        for k in (
            "state",
            "action",
            "error",
            "alert",
            "cleaning",
            "details",
            "availableCommands",
            "availableServices",
            "meta",
        ):
            if k in source:
                if isinstance(source[k], dict) and isinstance(cached.get(k), dict):
                    cached[k] = {**cached[k], **source[k]}
                else:
                    cached[k] = source[k]
        new_sig = (
            cached.get("state"),
            cached.get("action"),
            cached.get("error"),
            cached.get("alert"),
            (cached.get("details") or {}).get("charge"),
            (cached.get("details") or {}).get("isDocked"),
        )
        if new_sig != prev_sig:
            changed = True
        snap = copy.deepcopy(cached)

    meta = snap.get("meta") if isinstance(snap.get("meta"), dict) else {}
    _maybe_persist_telemetry(
        serial,
        snap,
        force=changed,
        model=meta.get("modelName"),
        firmware=meta.get("firmware"),
    )
    if changed:
        _fire_state_listeners(serial, snap)


def update_gen4_state_cache(serial: str, body: dict[str, Any]) -> None:
    if not isinstance(body, dict):
        return

    changed = False
    with _state_lock:
        if serial not in last_known_robot_state:
            last_known_robot_state[serial] = {
                "state": "idle",
                "action": "invalid",
                "errors": None,
                "available_commands": {
                    "start": True,
                    "cancel": False,
                    "pause": False,
                    "resume": False,
                    "return_to_base": False,
                },
                "details": {
                    "is_charging": False,
                    "is_docked": True,
                    "charge": 100,
                    "base_type": "standard",
                    "is_quickboost": False,
                    "quickboost_estimate": -1,
                },
                "cleaning_center": {
                    "base_error": None,
                    "bag_status": "bag_ok",
                    "is_extracting": False,
                },
                "autonomy_states": {
                    "started_on_base": True,
                    "active_cleaning_after_suspended": -1,
                    "active_cleaning_session": -1,
                    "cleaning_start": -1,
                    "docking": -1,
                    "docking_for_suspended": -1,
                    "docking_successful": -1,
                    "docking_successful_suspended": -1,
                    "docking_verify_base": -1,
                    "suspended_charging_start": -1,
                    "undocking": -1,
                    "undocking_after_suspended": -1,
                },
            }
            changed = True

        cached = last_known_robot_state[serial]
        prev_sig = (
            cached.get("state"),
            cached.get("action"),
            str(cached.get("errors")),
            (cached.get("details") or {}).get("charge"),
            (cached.get("details") or {}).get("is_docked"),
        )
        for k, v in body.items():
            if isinstance(v, dict) and isinstance(cached.get(k), dict):
                cached[k] = {**cached[k], **v}
            else:
                cached[k] = v
        new_sig = (
            cached.get("state"),
            cached.get("action"),
            str(cached.get("errors")),
            (cached.get("details") or {}).get("charge"),
            (cached.get("details") or {}).get("is_docked"),
        )
        if new_sig != prev_sig:
            changed = True
        snap = copy.deepcopy(cached)

    _maybe_persist_telemetry(serial, snap, force=changed)
    if changed:
        _fire_state_listeners(serial, snap)


def extract_fleet_summary(
    serial: str,
    robot_type: str,
    telemetry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with _state_lock:
        st = copy.deepcopy(last_known_robot_state.get(serial))

    if st is None and telemetry and isinstance(telemetry.get("last_state"), dict):
        st = telemetry["last_state"]

    summary: dict[str, Any] = {
        "model": (telemetry or {}).get("model"),
        "firmware": (telemetry or {}).get("firmware"),
        "ip_address": (telemetry or {}).get("ip_address"),
        "last_seen_at": (telemetry or {}).get("last_seen_at"),
        "charge": None,
        "is_docked": None,
        "is_charging": None,
        "state_label": "unknown",
        "has_error": False,
        "error_code": None,
        "last_state": st or None,
    }
    if not st:
        return summary

    if robot_type == "neato.gen3":
        details = st.get("details") or {}
        summary["charge"] = details.get("charge")
        summary["is_docked"] = details.get("isDocked")
        summary["is_charging"] = details.get("isCharging")
        meta = st.get("meta") or {}
        if not summary["model"] and meta.get("modelName"):
            summary["model"] = meta.get("modelName")
        if not summary["firmware"] and meta.get("firmware"):
            summary["firmware"] = meta.get("firmware")
        err = st.get("error") or st.get("alert")
        raw_state = st.get("state")
        raw_action = st.get("action")
        if raw_state == 4 or st.get("error"):
            summary["state_label"] = "error"
            summary["has_error"] = True
            summary["error_code"] = st.get("error")
        elif raw_state == 3:
            summary["state_label"] = "paused"
        elif raw_action == 4:
            summary["state_label"] = "docking"
        elif raw_state == 2 or raw_action in (1, 2, 3, 11, 12):
            summary["state_label"] = "cleaning"
        elif details.get("isDocked"):
            summary["state_label"] = "docked"
        else:
            summary["state_label"] = "idle"
        if err and not summary["error_code"]:
            summary["error_code"] = err
    else:
        details = st.get("details") or {}
        summary["charge"] = details.get("charge")
        summary["is_docked"] = details.get("is_docked")
        summary["is_charging"] = details.get("is_charging")
        errors = st.get("errors")
        err_code = None
        if isinstance(errors, list) and len(errors) > 0:
            first = errors[0]
            err_code = first.get("code") if isinstance(first, dict) else str(first)
        raw_state = str(st.get("state") or "").lower()
        raw_action = str(st.get("action") or "").lower()
        if raw_state == "error" or err_code:
            summary["state_label"] = "error"
            summary["has_error"] = True
            summary["error_code"] = err_code
        elif raw_state == "paused":
            summary["state_label"] = "paused"
        elif raw_action == "docking":
            summary["state_label"] = "docking"
        elif raw_state == "busy" or raw_action == "cleaning":
            summary["state_label"] = "cleaning"
        elif details.get("is_docked"):
            summary["state_label"] = "docked"
        else:
            summary["state_label"] = "idle"

    return summary


def get_cached_state_gen3(serial: str, req_id: Any) -> dict[str, Any]:
    with _state_lock:
        if serial not in last_known_robot_state:
            update_gen3_state_cache(serial, {})
            # If queried while actively connected and cleaning:
            last_known_robot_state[serial]["state"] = 2
            last_known_robot_state[serial]["action"] = 1
            last_known_robot_state[serial]["availableCommands"] = {
                "start": False,
                "stop": True,
                "pause": True,
                "resume": False,
                "goToBase": True,
            }
        cached = copy.deepcopy(last_known_robot_state[serial])

    cached["reqId"] = str(req_id)
    cached["result"] = "ok"
    return cached


def get_cached_state_gen4(serial: str, req_id: Any) -> dict[str, Any]:
    with _state_lock:
        if serial not in last_known_robot_state:
            update_gen4_state_cache(serial, {})
            last_known_robot_state[serial]["state"] = "busy"
            last_known_robot_state[serial]["action"] = "cleaning"
            last_known_robot_state[serial]["available_commands"] = {
                "start": False,
                "cancel": True,
                "pause": True,
                "resume": False,
                "return_to_base": True,
            }
        body = copy.deepcopy(last_known_robot_state[serial])

    return {
        "type": "response",
        "id": str(req_id),
        "code": 200,
        "body": body,
    }


def put_drop_oldest(q: queue.Queue, item: bytes) -> None:
    try:
        q.put_nowait(item)
    except queue.Full:
        with suppress(queue.Empty):
            q.get_nowait()
        with suppress(queue.Full):
            q.put_nowait(item)
