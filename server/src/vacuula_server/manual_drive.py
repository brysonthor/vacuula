from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import select
import socket
import struct
import threading
import time
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

from vacuula_server.fork_db import get_robot_telemetry
from vacuula_server.generation import get_gen3_robot_data
from vacuula_server.orchestrator import send_robot_command_sync
from vacuula_server.state import robot_connections

logger = logging.getLogger(__name__)

VALID_COMBOS = {
    "forward",
    "back",
    "stop",
    "arc-left",
    "arc-right",
    "pivot-left",
    "pivot-right",
}

VALID_COMMANDS = {
    "vacuum-on",
    "vacuum-off",
    "eco-on",
    "eco-off",
    "turbo-on",
    "turbo-off",
    "brush-on",
    "brush-off",
    "clean-spot",
    "issues",
}


class _SimpleWSClient:
    """Minimal RFC 6455 client socket for LAN robot manual drive."""

    def __init__(
        self,
        host: str,
        port: int,
        path: str = "/drive",
        serial: str | None = None,
        secret: str | None = None,
        timeout: float = 8.0,
    ) -> None:
        self.host = host
        self.port = port
        self.path = path
        self.serial = serial
        self.secret = secret
        self.sock: socket.socket | None = None
        self._send_lock = threading.Lock()
        self.connected = False
        self._rx_buf = bytearray()
        self.initial_message: dict[str, Any] | None = None
        self._connect(timeout)

    def _connect(self, timeout: float) -> None:
        sock = socket.create_connection((self.host, self.port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode("ascii")

        extra_headers = ""
        if self.serial and self.secret:
            # Neato Botvac Connected RFC 822 GMT date signature
            date_str = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
            payload = f"{self.serial.lower()}\n{date_str}\n"
            signature = hmac.new(
                self.secret.encode("utf-8"),
                payload.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            extra_headers = (
                f"Date: {date_str}\r\n"
                f"Authorization: NEATOAPP {signature}\r\n"
                f"Origin: ws://{self.host}:{self.port}{self.path}\r\n"
            )

        handshake = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            f"{extra_headers}\r\n"
        )
        sock.sendall(handshake.encode("ascii"))

        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(1024)
            if not chunk:
                sock.close()
                raise ConnectionError("Robot closed socket during WebSocket handshake")
            buf += chunk
            if len(buf) > 8192:
                sock.close()
                raise ConnectionError("Oversized WebSocket handshake header")

        header_bytes, rest = buf.split(b"\r\n\r\n", 1)
        header_line = header_bytes.split(b"\r\n", 1)[0].decode("latin1", errors="replace")
        if "101" not in header_line:
            sock.close()
            raise ConnectionError(f"WebSocket upgrade rejected: {header_line}")

        if rest:
            self._rx_buf.extend(rest)

        sock.settimeout(2.0)
        self.sock = sock
        self.connected = True

        # Check if robot sent an immediate frame (e.g. auth status or error)
        has_data = bool(self._rx_buf)
        if not has_data and self.sock:
            with suppress(Exception):
                r, _, _ = select.select([self.sock], [], [], 0.15)
                has_data = bool(r)

        if has_data:
            frame = self.recv_frame()
            if frame is not None:
                opcode, payload_bytes = frame
                if opcode == 0x1 and payload_bytes:
                    msg: Any = None
                    with suppress(Exception):
                        msg = json.loads(payload_bytes.decode("utf-8", errors="replace"))
                    if isinstance(msg, dict):
                        self.initial_message = msg
                        msg_text = str(msg.get("message") or msg.get("error") or "").lower()
                        if "invalid authorization" in msg_text or "unauthorized" in msg_text:
                            self.close()
                            raise PermissionError(f"Robot rejected manual drive authorization ({msg.get('message')})")

    def send_text(self, text: str) -> None:
        if not self.sock or not self.connected:
            raise ConnectionError("WebSocket not connected")
        payload = text.encode("utf-8")
        mask_key = os.urandom(4)
        length = len(payload)

        header = bytearray([0x81])  # FIN + text frame
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack(">H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack(">Q", length))

        header.extend(mask_key)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))

        with self._send_lock:
            self.sock.sendall(bytes(header) + masked)

    def send_pong(self, payload: bytes = b"") -> None:
        if not self.sock or not self.connected:
            return
        mask_key = os.urandom(4)
        header = bytearray([0x8A, 0x80 | min(125, len(payload))])
        header.extend(mask_key)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload[:125]))
        with self._send_lock, suppress(Exception):
            self.sock.sendall(bytes(header) + masked)

    def recv_frame(self) -> tuple[int, bytes] | None:
        if not self.sock or not self.connected:
            return None
        try:
            hdr = self._recv_exact(2)
        except TimeoutError:
            return None
        if not hdr:
            self.connected = False
            return None

        opcode = hdr[0] & 0x0F
        masked = bool(hdr[1] & 0x80)
        length = hdr[1] & 0x7F
        if length == 126:
            ext = self._recv_exact(2)
            if not ext:
                self.connected = False
                return None
            length = struct.unpack(">H", ext)[0]
        elif length == 127:
            ext = self._recv_exact(8)
            if not ext:
                self.connected = False
                return None
            length = struct.unpack(">Q", ext)[0]

        mask_key = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length) if length > 0 else b""
        if length > 0 and not payload:
            self.connected = False
            return None
        if masked and mask_key:
            payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        return opcode, payload

    def _recv_exact(self, n: int) -> bytes:
        assert self.sock is not None
        out = bytearray()
        if self._rx_buf:
            take = min(n, len(self._rx_buf))
            out.extend(self._rx_buf[:take])
            del self._rx_buf[:take]
        while len(out) < n:
            try:
                chunk = self.sock.recv(n - len(out))
            except TimeoutError:
                if out:
                    self._rx_buf = out + self._rx_buf
                raise
            if not chunk:
                return b""
            out.extend(chunk)
        return bytes(out)

    def close(self) -> None:
        self.connected = False
        if self.sock:
            with self._send_lock, suppress(Exception):
                # Masked close frame
                mask = os.urandom(4)
                self.sock.sendall(bytes([0x88, 0x80]) + mask)
            with suppress(Exception):
                self.sock.close()
            self.sock = None


class _DriveSession:
    def __init__(self, serial: str, ws: _SimpleWSClient, ip: str, port: int, ssid: str | None) -> None:
        self.serial = serial
        self.ws = ws
        self.ip = ip
        self.port = port
        self.ssid = ssid
        self.active_combo: str = "stop"
        self.last_motion_ts: float = time.monotonic()
        self.last_ui_ts: float = time.monotonic()
        self.last_robot_message: dict[str, Any] | None = getattr(ws, "initial_message", None)
        self.vacuum_on: bool = False
        self.brush_on: bool = False
        self.eco_on: bool = True
        self.stop_event = threading.Event()
        self._lock = threading.Lock()

    def start_loops(self) -> None:
        threading.Thread(target=self._tx_loop, daemon=True, name=f"drive-tx-{self.serial}").start()
        threading.Thread(target=self._rx_loop, daemon=True, name=f"drive-rx-{self.serial}").start()

    def set_combo(self, combo: str) -> None:
        with self._lock:
            self.active_combo = combo
            self.last_motion_ts = time.monotonic()
            self.last_ui_ts = time.monotonic()
        with suppress(Exception):
            self.ws.send_text(json.dumps({"combo": combo}))

    def send_command(self, cmd: str) -> None:
        with self._lock:
            self.last_ui_ts = time.monotonic()
            if cmd == "vacuum-on":
                self.vacuum_on = True
            elif cmd == "vacuum-off":
                self.vacuum_on = False
            elif cmd == "brush-on":
                self.brush_on = True
            elif cmd == "brush-off":
                self.brush_on = False
            elif cmd in ("eco-on", "turbo-off"):
                self.eco_on = True
            elif cmd in ("eco-off", "turbo-on"):
                self.eco_on = False
        self.ws.send_text(json.dumps({"command": cmd}))

    def _tx_loop(self) -> None:
        last_idle_keepalive = 0.0
        while not self.stop_event.is_set() and self.ws.connected:
            time.sleep(0.55)
            now = time.monotonic()
            with self._lock:
                combo = self.active_combo
                since_motion = now - self.last_motion_ts
                since_ui = now - self.last_ui_ts

            # Close session after 90s of total UI inactivity
            if since_ui > 90.0:
                logger.info("Closing idle manual drive session for %s", self.serial)
                self.shutdown()
                return

            # Safety deadman switch: halt motion if client stopped refreshing movement
            if combo != "stop" and since_motion > 1.5:
                with self._lock:
                    self.active_combo = "stop"
                combo = "stop"
                with suppress(Exception):
                    self.ws.send_text(json.dumps({"combo": "stop"}))
                last_idle_keepalive = now
                continue

            if combo != "stop":
                try:
                    self.ws.send_text(json.dumps({"combo": combo}))
                except Exception:
                    self.shutdown()
                    return
            elif (now - last_idle_keepalive) >= 8.0:
                try:
                    self.ws.send_text(json.dumps({"combo": "stop"}))
                    last_idle_keepalive = now
                except Exception:
                    self.shutdown()
                    return

    def _rx_loop(self) -> None:
        while not self.stop_event.is_set() and self.ws.connected:
            try:
                frame = self.ws.recv_frame()
            except Exception:
                break
            if frame is None:
                continue
            opcode, payload = frame
            if opcode == 0x8:  # Close
                break
            if opcode == 0x9:  # Ping
                self.ws.send_pong(payload)
            elif opcode == 0x1 and payload:  # Text
                with suppress(Exception):
                    msg = json.loads(payload.decode("utf-8", errors="replace"))
                    if isinstance(msg, dict):
                        with self._lock:
                            self.last_robot_message = msg
                        msg_text = str(msg.get("message") or msg.get("error") or "").lower()
                        if "invalid authorization" in msg_text or "unauthorized" in msg_text:
                            logger.error("Robot %s rejected authorization during manual drive: %s", self.serial, msg)
                            self.shutdown()
                            return
        self.shutdown()

    def status_dict(self) -> dict[str, Any]:
        with self._lock:
            return {
                "connected": self.ws.connected and not self.stop_event.is_set(),
                "ip_address": self.ip,
                "port": self.port,
                "ssid": self.ssid,
                "active_combo": self.active_combo,
                "vacuum_on": self.vacuum_on,
                "brush_on": self.brush_on,
                "eco_on": self.eco_on,
                "robot_message": self.last_robot_message,
            }

    def shutdown(self) -> None:
        if self.stop_event.is_set():
            return
        self.stop_event.set()
        with suppress(Exception):
            self.ws.send_text(json.dumps({"combo": "stop"}))
        self.ws.close()
        with _sessions_lock:
            if _sessions.get(self.serial) is self:
                _sessions.pop(self.serial, None)


_sessions_lock = threading.Lock()
_sessions: dict[str, _DriveSession] = {}


def drive_start(serial: str) -> tuple[int, dict[str, Any]]:
    if "-" not in serial:
        return 400, {"error": "Manual drive is supported on Neato Gen 3 robots only"}
    if serial not in robot_connections:
        return 400, {"error": "Robot is offline"}

    with _sessions_lock:
        existing = _sessions.get(serial)
        if existing and existing.ws.connected and not existing.stop_event.is_set():
            existing.last_ui_ts = time.monotonic()
            return 200, existing.status_dict()

    status, resp = send_robot_command_sync(serial, {"cmd": "getRobotManualCleaningInfo"}, timeout_s=15.0)
    if status != 200 or not isinstance(resp, dict) or resp.get("result") != "ok":
        err = (resp or {}).get("error") if isinstance(resp, dict) else "Robot rejected manual cleaning request"
        return 502, {"error": f"Manual drive unavailable: {err}"}

    data = resp.get("data") or {}
    ip = str(data.get("ip_address") or "").strip()
    port = int(data.get("port") or 0)
    ssid = data.get("ssid")

    if not ip or ip == "0.0.0.0":
        tel = get_robot_telemetry(serial)
        if tel and tel.get("ip_address"):
            ip = str(tel["ip_address"])

    if not ip or port <= 0:
        return 502, {"error": "Robot did not provide valid LAN WebSocket address"}

    gen3_data = get_gen3_robot_data(serial)
    secret = gen3_data.password if gen3_data else ""
    if not secret:
        conn = robot_connections.get(serial)
        if conn and hasattr(conn, "conn") and hasattr(conn.conn, "password"):
            secret = conn.conn.password or ""

    # Robot often needs ~0.5s after getRobotManualCleaningInfo to spin up its WS listener
    last_err: Exception | None = None
    ws: _SimpleWSClient | None = None
    for attempt in range(4):
        if attempt > 0:
            time.sleep(0.6)
        try:
            ws = _SimpleWSClient(ip, port, path="/drive", serial=serial, secret=secret, timeout=6.0)
            break
        except Exception as e:
            last_err = e
            if isinstance(e, PermissionError):
                return 502, {"error": str(e)}

    if ws is None:
        return 502, {
            "error": f"Could not reach robot manual drive socket at ws://{ip}:{port}/drive ({last_err}). Ensure Vacuula server has LAN access to the robot."
        }

    sess = _DriveSession(serial, ws, ip, port, ssid)
    with _sessions_lock:
        old = _sessions.pop(serial, None)
        if old:
            old.shutdown()
        _sessions[serial] = sess
    sess.start_loops()
    return 200, sess.status_dict()


def drive_input(serial: str, data: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    with _sessions_lock:
        sess = _sessions.get(serial)
    if not sess or not sess.ws.connected or sess.stop_event.is_set():
        return 400, {"error": "No active manual drive session"}

    combo = data.get("combo")
    command = data.get("command")
    try:
        if combo is not None:
            combo_str = str(combo)
            if combo_str not in VALID_COMBOS:
                return 400, {"error": f"Unsupported combo: {combo_str}"}
            sess.set_combo(combo_str)
        if command is not None:
            cmd_str = str(command)
            if cmd_str not in VALID_COMMANDS:
                return 400, {"error": f"Unsupported command: {cmd_str}"}
            sess.send_command(cmd_str)
    except Exception as e:
        sess.shutdown()
        return 502, {"error": f"Drive socket closed: {e}"}

    return 200, sess.status_dict()


def drive_status(serial: str) -> tuple[int, dict[str, Any]]:
    with _sessions_lock:
        sess = _sessions.get(serial)
    if not sess or not sess.ws.connected or sess.stop_event.is_set():
        return 200, {"connected": False}
    sess.last_ui_ts = time.monotonic()
    return 200, sess.status_dict()


def drive_stop(serial: str) -> tuple[int, dict[str, Any]]:
    with _sessions_lock:
        sess = _sessions.pop(serial, None)
    if sess:
        sess.shutdown()
    if serial in robot_connections:
        with suppress(Exception):
            send_robot_command_sync(serial, {"cmd": "stopCleaning"}, timeout_s=8.0)
    return 200, {"connected": False, "stopped": True}
