from __future__ import annotations

import logging
import threading
import time
from typing import Any

from vacuula_server import env
from vacuula_server.generation import Generation
from vacuula_server.state import robot_connections

logger = logging.getLogger(__name__)

_poller_thread: threading.Thread | None = None
_poller_lock = threading.Lock()
_stop_event = threading.Event()
_last_polled: dict[str, float] = {}


def poll_robot(serial: str, timeout_s: float = 10.0) -> tuple[int, Any]:
    """Send getRobotState to a Gen 3 robot to keep its Wi-Fi connection awake and refresh state."""
    from vacuula_server.orchestrator import send_robot_command_sync

    logger.debug("Polling Gen 3 robot %s (keepalive / state refresh)", serial)
    status, resp = send_robot_command_sync(serial, {"cmd": "getRobotState"}, timeout_s=timeout_s)
    if status != 200:
        logger.debug("Keepalive poll for %s returned status %s: %s", serial, status, resp)
    else:
        logger.debug("Keepalive poll for %s succeeded", serial)
    return status, resp


def poll_all_gen3_robots(timeout_s: float = 10.0) -> dict[str, tuple[int, Any]]:
    """Poll all currently connected Gen 3 robots."""
    results: dict[str, tuple[int, Any]] = {}
    serials = [
        serial
        for serial, conn in list(robot_connections.items())
        if conn.gen == Generation.GEN3
    ]
    for serial in serials:
        results[serial] = poll_robot(serial, timeout_s=timeout_s)
    return results


def _poller_tick(interval_s: float) -> None:
    now = time.monotonic()
    serials = [
        serial
        for serial, conn in list(robot_connections.items())
        if conn.gen == Generation.GEN3
    ]

    # Clean up disconnected serials
    for s in list(_last_polled.keys()):
        if s not in robot_connections:
            _last_polled.pop(s, None)

    for serial in serials:
        last = _last_polled.get(serial)
        if last is None:
            # First time seeing this connected robot; start timer from now
            _last_polled[serial] = now
            continue

        if (now - last) >= interval_s:
            _last_polled[serial] = now
            threading.Thread(
                target=poll_robot,
                args=(serial,),
                name=f"gen3-poll-{serial}",
                daemon=True,
            ).start()


def _poller_loop() -> None:
    logger.info("Gen 3 keepalive poller started (interval: %ds)", env.GEN3_POLL_INTERVAL)
    while not _stop_event.is_set():
        try:
            interval = env.GEN3_POLL_INTERVAL
            if interval > 0:
                _poller_tick(interval)
        except Exception as e:  # noqa: BLE001
            logger.error("Error in Gen 3 keepalive poller tick: %s", e)
        _stop_event.wait(5.0)


def start_gen3_poller_thread() -> None:
    global _poller_thread
    with _poller_lock:
        if env.GEN3_POLL_INTERVAL <= 0:
            logger.info("Gen 3 keepalive poller disabled (GEN3_POLL_INTERVAL <= 0)")
            return
        if _poller_thread is not None and _poller_thread.is_alive():
            return
        _stop_event.clear()
        _poller_thread = threading.Thread(
            target=_poller_loop,
            daemon=True,
            name="vacuula-gen3-poller",
        )
        _poller_thread.start()


def stop_gen3_poller_thread() -> None:
    global _poller_thread
    with _poller_lock:
        _stop_event.set()
        if _poller_thread is not None:
            _poller_thread.join(timeout=2.0)
            _poller_thread = None
