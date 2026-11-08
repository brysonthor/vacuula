from __future__ import annotations
import logging
from vacuula_server import state
import json
import time
from vacuula_server.discord import notify_gen3_state
from vacuula_server.state import pending_requests, put_drop_oldest, update_gen3_state_cache
import typing

logger = logging.getLogger(__name__)

# per-robot temporary buffers (maintained for backwards compatibility)
robot_buffers: dict[str, int] = {}

def reset_robot_buffer(serial: str) -> None:
    robot_buffers.pop(serial, None)

def robot_message(serial: str, data: bytes):
    """Handle one whole message from the robot (see gen3.chunked): a heartbeat or a JSON object."""
    data = data.strip()
    if not data.startswith(b'{'):
        logger.debug("heartbeat from robot %s", serial)
        return

    try:
        decoded: dict = json.loads(data.decode())
    except Exception as e:
        logger.error("failed to parse JSON from %s: %s", serial, e)
        return

    if not isinstance(decoded, dict):
        logger.warning("unexpected message from %s, ignored: %.200s", serial, data)
        return

    eventId = decoded.get("eventId")
    reqId = decoded.get("reqId")

    logger.debug("robot_data: serial=%s eventId=%s reqId=%s data=%s", serial, eventId, reqId, data)

    req_key = str(reqId) if reqId is not None else None
    slot = None
    if req_key and (req_key in pending_requests or reqId in pending_requests):
        slot = pending_requests.get(req_key) or pending_requests.get(reqId)
        result = decoded.get("result")
        if slot is not None:
            slot.fulfill(data, 200 if result == "ok" else 400)

    has_state_or_details = (
        decoded.get("state") is not None
        or decoded.get("action") is not None
        or "details" in decoded
        or "details" in (decoded.get("data") or {})
    )

    # Always update Gen 3 state cache when state or details are present
    if has_state_or_details:
        update_gen3_state_cache(serial, decoded)

    if reqId is not None:
        if decoded.get("state") is not None or decoded.get("action") is not None:
            try:
                notify_gen3_state(serial, decoded)
            except Exception as e:
                logger.debug("Discord notify_gen3_state failed: %s", e)
    elif eventId:
        try:
            notify_gen3_state(serial, decoded)
        except Exception as e:
            logger.debug("Discord notify_gen3_state failed: %s", e)

    # Forward any state updates or events to SSE client streams
    clients = [c for c in state.client_connections if c["serial"] == serial]
    if clients and (eventId or has_state_or_details):
        msg = json.dumps({
            "serial": serial,
            "event": eventId,
            "type": "neato.gen3",
            "data": decoded,      # parsed dict, not raw bytes
            "ts": time.time(),
        }) + "\n"
        frame = f"data: {msg}\n\n".encode()
        for client in clients:
            put_drop_oldest(client["queue"], frame)

    if reqId is None and not eventId:
        logger.error("no eventId or reqId in data from %s", serial)

def robot_data(serial: str, data: bytes):
    """Handle incoming line/chunk data from robot (legacy 2-step compatibility)."""
    if serial not in robot_buffers:
        try:
            robot_buffers[serial] = int(data.strip(), 16)
        except ValueError:
            logger.warning("Invalid chunk length from %s: %r", serial, data)
        return

    msg_size = robot_buffers.pop(serial, None)
    data = data[:-2]
    if not data:
        return
    if chr(data[0]) != '{' and msg_size == 1:
        logger.debug("heartbeat from robot %s", serial)
        return
    robot_message(serial, data)

