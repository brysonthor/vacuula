from __future__ import annotations
import logging
import socket
import threading
import time
from vacuula_server.gen3.commands import send_chunk, build_heartbeat, release_send_lock
from vacuula_server.fork_db import upsert_robot_telemetry
from vacuula_server.orchestrator import refresh_gen3_telemetry_async
from vacuula_server.state import robot_connections
from vacuula_server.handlers.events import notify_robots_changed
from vacuula_server.gen3.utils import get_robot_serial
from vacuula_server.db import get_session
from vacuula_server.gen3.event_handler import robot_data, reset_robot_buffer
from vacuula_server.models.robot import Robot
from sqlalchemy import select
from typing import TYPE_CHECKING
from vacuula_server.generation import get_gen3_robot_data, get_robot_by_serial, Generation
from vacuula_server.conn import RobotConn, Gen2Gen3Conn
import traceback
if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

logger = logging.getLogger(__name__)

# Gen 3 robots send a 1-byte heartbeat chunk roughly every 30s, but while
# docked (Wi-Fi power-save) they regularly skip heartbeats. Application-level
# silence is therefore NOT a sign of a dead link, and every server-initiated
# disconnect risks the robot staying asleep and not reconnecting for hours.
#
# Do NOT send periodic synthetic chunks from the server: Gen 3 firmware only
# accepts signed command envelopes on an established stream and disconnects if
# unsolicited unsigned JSON is pushed.
#
# Instead of an application-level read timeout we:
#   * perform blocking reads on req.rfile (sock.settimeout(None)), and
#   * let the kernel TCP stack detect real link loss via TCP keepalives
#     (TCP_KEEPIDLE, TCP_KEEPINTVL, TCP_KEEPCNT) and TCP_USER_TIMEOUT.
#
# NOTE: never put a timeout on the socket and read via req.rfile: after a
# single socket.timeout CPython marks the SocketIO as timed out and every
# later read raises "cannot read from timed out object".
QUIET_LOG_AFTER_S = 45
TCP_USER_TIMEOUT_MS = 300_000
TCP_KEEPALIVE_OPTS = (
    ("TCP_KEEPIDLE", 60),
    ("TCP_KEEPINTVL", 15),
    ("TCP_KEEPCNT", 8),
)


def configure_robot_socket(sock) -> None:
    """Blocking reads; dead-peer detection delegated to TCP."""
    sock.settimeout(None)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    for name, value in TCP_KEEPALIVE_OPTS:
        if hasattr(socket, name):
            try:
                sock.setsockopt(socket.IPPROTO_TCP, getattr(socket, name), value)
            except OSError:
                pass
    if hasattr(socket, "TCP_USER_TIMEOUT"):
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_USER_TIMEOUT, TCP_USER_TIMEOUT_MS)
        except OSError:
            pass


def shutdown_robot_socket(sock) -> None:
    """Wake up a reader blocked on `sock` without touching its SSL state."""
    if sock is None:
        return
    try:
        # Bypass SSLSocket.shutdown(), which drops _sslobj while another
        # thread may still be inside SSL_read.
        socket.socket.shutdown(sock, socket.SHUT_RDWR)
    except Exception:
        pass


class _SessionState:
    def __init__(self) -> None:
        self.last_rx = time.monotonic()
        self.quiet_logged = False
        self.end_reason: str | None = None


def nucleo_init(req: RouterHandler) -> None:
    """POST /vendors/neato/login - robot commands"""
    if not (serial := get_robot_serial(req)): return

    if not (gen3_data := get_gen3_robot_data(serial)):
        req.send_not_found("Robot not found")
        return

    sock = req.connection
    configure_robot_socket(sock)

    req.send_response(200)
    req.send_header("Transfer-Encoding", "chunked")
    req.send_header("Connection", "close")
    req.end_headers()

    send_chunk(req.wfile, build_heartbeat())
    conn = RobotConn(serial, Generation.GEN3, Gen2Gen3Conn(gen3_data.password, req.wfile, sock))

    # Signal and cleanly supersede any previous connection for this robot
    old_conn = robot_connections.get(serial)
    if old_conn and old_conn is not conn:
        old_conn.stop_event.set()
        shutdown_robot_socket(getattr(old_conn.conn, "sock", None))
        try:
            old_conn.conn.wfile.close()
        except Exception:
            pass

    # Chunk framing state is keyed by serial; never carry a half-read chunk
    # header from a previous session into this one.
    reset_robot_buffer(serial)
    robot_connections[serial] = conn
    upsert_robot_telemetry(serial, ip_address=req.client_address[0], touch_seen=True)
    logger.info("Robot %s connected", serial)
    notify_robots_changed()
    refresh_gen3_telemetry_async(serial)

    state = _SessionState()
    connected_at = time.monotonic()

    try:
        while not conn.stop_event.is_set():
            data = req.rfile.readline()
            if not data:
                state.end_reason = state.end_reason or "EOF from robot"
                break

            now = time.monotonic()
            if state.quiet_logged:
                logger.info("Robot %s resumed after %ds of silence", serial, now - state.last_rx)
                state.quiet_logged = False
            state.last_rx = now
            robot_data(serial, data)
    except Exception as e:
        state.end_reason = state.end_reason or f"connection error: {e!r}"
        if not conn.stop_event.is_set():
            logger.error("Robot %s connection error: %r", serial, e)
    finally:
        superseded = robot_connections.get(serial) is not conn
        conn.stop_event.set()
        release_send_lock(req.wfile)
        if superseded:
            state.end_reason = "superseded by a newer login"
        logger.info(
            "Robot %s session ended after %ds: %s (last robot data %ds ago)",
            serial,
            time.monotonic() - connected_at,
            state.end_reason or "stopped",
            time.monotonic() - state.last_rx,
        )
        if not superseded:
            reset_robot_buffer(serial)
            del robot_connections[serial]
            logger.info("Robot %s disconnected", serial)
            notify_robots_changed()
