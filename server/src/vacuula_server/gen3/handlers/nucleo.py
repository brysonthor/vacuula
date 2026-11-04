from __future__ import annotations
import logging
import socket
from vacuula_server.gen3.commands import send_chunk, build_heartbeat
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

def nucleo_init(req: RouterHandler) -> None:
    """POST /vendors/neato/login - robot commands"""
    if not (serial := get_robot_serial(req)): return

    if not (gen3_data := get_gen3_robot_data(serial)):
        req.send_not_found("Robot not found")
        return

    sock = req.connection
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    if hasattr(socket, "TCP_USER_TIMEOUT"):
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_USER_TIMEOUT, 90_000)
    # Read timeout of 60s; on timeout the server pings with a heartbeat chunk
    # to keep the radio active and connection healthy without dropping the session.
    sock.settimeout(60)

    req.send_response(200)
    req.send_header("Transfer-Encoding", "chunked")
    req.send_header("Connection", "close")
    req.end_headers()

    send_chunk(req.wfile, build_heartbeat())
    conn = RobotConn(serial, Generation.GEN3, Gen2Gen3Conn(gen3_data.password, req.wfile))

    # Signal and cleanly supersede any previous connection for this robot
    old_conn = robot_connections.get(serial)
    if old_conn and old_conn is not conn:
        old_conn.stop_event.set()
        try:
            old_conn.conn.wfile.close()
        except Exception:
            pass

    robot_connections[serial] = conn
    upsert_robot_telemetry(serial, ip_address=req.client_address[0], touch_seen=True)
    logger.info("Robot %s connected", serial)
    notify_robots_changed()
    refresh_gen3_telemetry_async(serial)

    try:
        while not conn.stop_event.is_set():
            try:
                data = req.rfile.readline()
            except (TimeoutError, socket.timeout):
                # Idle on dock or in Wi-Fi power-save: ping with heartbeat chunk
                try:
                    send_chunk(req.wfile, build_heartbeat())
                except Exception as e:
                    logger.warning("Robot %s heartbeat ping failed: %s", serial, e)
                    break
                continue

            if not data:
                break
            robot_data(serial, data)
    except Exception as e:
        logger.error("Robot %s connection error: %s", serial, e)
    finally:
        conn.stop_event.set()
        reset_robot_buffer(serial)
        if robot_connections.get(serial) is conn:
            del robot_connections[serial]
            logger.info("Robot %s disconnected", serial)
            notify_robots_changed()
