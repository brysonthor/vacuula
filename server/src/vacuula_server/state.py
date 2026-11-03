from __future__ import annotations
from vacuula_server.conn import RobotConn
from typing import Dict, Any
import copy
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


def update_gen3_state_cache(serial: str, payload: dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        return
    source = payload.get("data") if (isinstance(payload.get("data"), dict) and "state" in payload["data"]) else payload
    if not isinstance(source, dict):
        return

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

        cached = last_known_robot_state[serial]
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


def update_gen4_state_cache(serial: str, body: dict[str, Any]) -> None:
    if not isinstance(body, dict):
        return

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

        cached = last_known_robot_state[serial]
        for k, v in body.items():
            if isinstance(v, dict) and isinstance(cached.get(k), dict):
                cached[k] = {**cached[k], **v}
            else:
                cached[k] = v


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
