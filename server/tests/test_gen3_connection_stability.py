"""Gen 3 (nucleo) connection stability.

Background: Gen 3 robots heartbeat every ~30s but regularly skip one or two
while docked. Earlier versions treated 60s/180s of silence as a dead link and
closed the session, and the robot then sometimes failed to reconnect for hours.
These tests pin the replacement behaviour: blocking reads, periodic server
heartbeats, TCP-level dead-peer detection and a non-blocking TLS accept loop.
"""
import errno
import io
import logging
import shutil
import socket
import ssl
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler
from unittest.mock import MagicMock, patch

import pytest

from vacuula_server.db import get_session
from vacuula_server.gen3 import init as gen3_init
from vacuula_server.gen3.data import Gen3Data
from vacuula_server.gen3.handlers import nucleo
from vacuula_server.models.robot import Robot
from vacuula_server.state import robot_connections

SERIAL = "OPS99999-001122334455"
PAYLOAD = b'{"state": 1, "action": 0}\r\n'
SIZE_LINE = f"{len(PAYLOAD) - 2:x}\r\n".encode()


class FakeReq:
    def __init__(self, rfile=None, wfile=None, connection=None):
        self.headers = {"Authorization": f"NEATOBOT {SERIAL}:dummyhash"}
        self.client_address = ("127.0.0.1", 4242)
        self.status = None
        self.rfile = rfile or io.BytesIO(b"")
        self.wfile = wfile or io.BytesIO()
        self.connection = connection or MagicMock()

    def send_response(self, code):
        self.status = code

    def send_header(self, k, v):
        pass

    def end_headers(self):
        pass

    def send_not_found(self, message="Not Found"):
        self.status = 404


@pytest.fixture
def gen3_robot():
    with get_session() as session:
        session.add(Robot(serial=SERIAL, type="neato.gen3", name="Sparkles"))
        session.add(Gen3Data(robot=SERIAL, password="pw", installed_with="1.0.0"))
        session.commit()
    yield SERIAL
    robot_connections.pop(SERIAL, None)


@pytest.fixture
def fast_quiet_log(monkeypatch):
    monkeypatch.setattr(nucleo, "QUIET_LOG_AFTER_S", 0.1)


@pytest.fixture
def no_side_effects():
    with patch.object(nucleo, "refresh_gen3_telemetry_async"), \
         patch.object(nucleo, "notify_robots_changed"), \
         patch.object(nucleo, "upsert_robot_telemetry"):
        yield


def _scripted_readline(*steps):
    """Each step is bytes to return, an Exception to raise, or a float to sleep."""
    steps = list(steps)

    def readline():
        while steps:
            step = steps.pop(0)
            if isinstance(step, float):
                time.sleep(step)
                continue
            if isinstance(step, BaseException):
                raise step
            return step
        return b""

    return readline


def test_silent_robot_keeps_session_open_and_resumes(
    gen3_robot, no_side_effects, caplog
):
    req = FakeReq()
    # Robot goes quiet (simulating Wi-Fi power-save sleep on dock), then resumes.
    req.rfile.readline = _scripted_readline(0.3, SIZE_LINE, PAYLOAD)

    with patch.object(nucleo, "send_chunk") as send_chunk, caplog.at_level(logging.INFO):
        nucleo.nucleo_init(req)

    # Exactly 1 heartbeat on connect (the login handshake) and none while the robot was silent
    assert send_chunk.call_count == 1
    messages = "\n".join(r.getMessage() for r in caplog.records)
    assert "EOF from robot" in messages
    assert SERIAL not in robot_connections


def test_tcp_dead_peer_error_ends_session_cleanly(gen3_robot, no_side_effects, caplog):
    req = FakeReq()
    req.rfile.readline = _scripted_readline(
        SIZE_LINE, PAYLOAD, OSError(errno.ETIMEDOUT, "Connection timed out")
    )

    with caplog.at_level(logging.INFO):
        nucleo.nucleo_init(req)

    messages = "\n".join(r.getMessage() for r in caplog.records)
    assert "Connection timed out" in messages
    assert f"Robot {SERIAL} disconnected" in messages
    assert SERIAL not in robot_connections


def test_shutdown_unblocks_blocking_reader(gen3_robot, no_side_effects, caplog):
    """shutdown_robot_socket must unblock a thread waiting in readline()."""
    unblocked = threading.Event()

    def readline():
        if not unblocked.wait(timeout=5):
            raise AssertionError("reader was never unblocked")
        raise OSError(errno.EBADF, "socket shut down")

    req = FakeReq()
    req.rfile.readline = readline

    def trigger_shutdown():
        time.sleep(0.05)
        nucleo.shutdown_robot_socket(req.connection)
        unblocked.set()

    threading.Thread(target=trigger_shutdown, daemon=True).start()
    nucleo.nucleo_init(req)

    assert unblocked.is_set()
    assert SERIAL not in robot_connections


def test_new_login_supersedes_and_wakes_old_session(gen3_robot, no_side_effects, caplog):
    old_sock, new_sock = MagicMock(name="old"), MagicMock(name="new")
    released = {old_sock: threading.Event(), new_sock: threading.Event()}

    def blocking_readline(sock):
        def readline():
            if not released[sock].wait(timeout=5):
                raise AssertionError("session was never released")
            return b""
        return readline

    old_req = FakeReq(connection=old_sock)
    old_req.rfile.readline = blocking_readline(old_sock)
    new_req = FakeReq(connection=new_sock)
    new_req.rfile.readline = blocking_readline(new_sock)

    with patch.object(nucleo, "shutdown_robot_socket", side_effect=lambda s: s and released[s].set()), \
         caplog.at_level(logging.INFO):
        old_t = threading.Thread(target=nucleo.nucleo_init, args=(old_req,))
        old_t.start()
        while robot_connections.get(SERIAL) is None:
            time.sleep(0.01)

        new_t = threading.Thread(target=nucleo.nucleo_init, args=(new_req,))
        new_t.start()

        old_t.join(timeout=5)
        assert not old_t.is_alive(), "old session should be woken up by the new login"
        current = robot_connections.get(SERIAL)
        assert current is not None and current.conn.sock is new_sock

        released[new_sock].set()
        new_t.join(timeout=5)

    messages = "\n".join(r.getMessage() for r in caplog.records)
    assert "superseded by a newer login" in messages
    assert SERIAL not in robot_connections


def test_real_socket_survives_robot_silence(gen3_robot, no_side_effects):
    """End-to-end over TCP: silence must not poison the reader (the old bug)."""
    listener = socket.create_server(("127.0.0.1", 0))
    robot = socket.create_connection(listener.getsockname())
    server_side, _ = listener.accept()
    listener.close()

    req = FakeReq(
        rfile=server_side.makefile("rb"),
        wfile=server_side.makefile("wb"),
        connection=server_side,
    )
    t = threading.Thread(target=nucleo.nucleo_init, args=(req,), daemon=True)
    t.start()
    try:
        time.sleep(0.4)  # robot silent
        assert t.is_alive(), "session must stay open while the robot is quiet"
        robot.settimeout(2)
        received = robot.recv(65536)
        assert b'"heartbeat"' in received
        assert received.count(b'"heartbeat"') == 1

        robot.sendall(SIZE_LINE + PAYLOAD)  # robot resumes on the same socket
        time.sleep(0.1)
        assert t.is_alive()
        assert robot_connections.get(SERIAL) is not None
    finally:
        robot.close()
        t.join(timeout=5)
        server_side.close()
    assert not t.is_alive()
    assert SERIAL not in robot_connections


def test_configure_robot_socket_relaxed_keepalive():
    """Verify configure_robot_socket applies relaxed keepalive and no TCP_USER_TIMEOUT."""
    assert nucleo.TCP_KEEPALIVE_OPTS == (
        ("TCP_KEEPIDLE", 1800),
        ("TCP_KEEPINTVL", 60),
        ("TCP_KEEPCNT", 10),
    )
    assert not hasattr(nucleo, "TCP_USER_TIMEOUT_MS")

    with patch.object(socket, "TCP_KEEPIDLE", 4, create=True), \
         patch.object(socket, "TCP_KEEPINTVL", 5, create=True), \
         patch.object(socket, "TCP_KEEPCNT", 6, create=True), \
         patch.object(socket, "TCP_USER_TIMEOUT", 18, create=True):
        mock_sock = MagicMock()
        nucleo.configure_robot_socket(mock_sock)

        mock_sock.settimeout.assert_called_once_with(None)
        mock_sock.setsockopt.assert_any_call(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)

        # Check keepalive settings match relaxed parameters
        setsockopt_calls = mock_sock.setsockopt.call_args_list
        tcp_calls = [call for call in setsockopt_calls if call.args[0] == socket.IPPROTO_TCP]

        assert any(c.args[1] == 4 and c.args[2] == 1800 for c in tcp_calls)
        assert any(c.args[1] == 5 and c.args[2] == 60 for c in tcp_calls)
        assert any(c.args[1] == 6 and c.args[2] == 10 for c in tcp_calls)

        # Ensure TCP_USER_TIMEOUT is NOT applied
        assert not any(c.args[1] == 18 for c in tcp_calls)


def test_tls_handshake_timeout_is_120():
    assert gen3_init.TLS_HANDSHAKE_TIMEOUT_S == 120


# --- Gen3 HTTPS listener ----------------------------------------------------

@pytest.fixture
def tls_context(tmp_path):
    if not shutil.which("openssl"):
        pytest.skip("openssl CLI not available")
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
         "-subj", "/CN=localhost", "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    return ctx


class OkHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


def _https_get(port):
    client_ctx = ssl.create_default_context()
    client_ctx.check_hostname = False
    client_ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection(("127.0.0.1", port), timeout=5) as raw:
        with client_ctx.wrap_socket(raw) as s:
            s.sendall(b"GET / HTTP/1.0\r\nHost: x\r\n\r\n")
            return s.recv(1024)


def test_stalled_tls_client_does_not_block_new_connections(tls_context, monkeypatch, caplog):
    monkeypatch.setattr(gen3_init, "TLS_HANDSHAKE_TIMEOUT_S", 0.5)
    server = gen3_init.Gen3HTTPSServer(("127.0.0.1", 0), OkHandler, tls_context)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    try:
        # A client that connects but never sends a ClientHello.
        staller = socket.create_connection(("127.0.0.1", port))
        try:
            assert _https_get(port).startswith(b"HTTP/1.0 200")
            with caplog.at_level(logging.WARNING):
                time.sleep(1.0)
            assert any("TLS handshake failed" in r.getMessage() for r in caplog.records)
        finally:
            staller.close()
    finally:
        server.shutdown()
        server.server_close()
