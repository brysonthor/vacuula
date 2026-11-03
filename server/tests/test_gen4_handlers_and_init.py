import io
import json
import struct
import time
import os
import pytest
from unittest.mock import MagicMock, patch

from vacuula_server.conn import RobotConn, Gen4Conn
from vacuula_server.generation import Generation
from vacuula_server.gen4 import handlers as gen4_handlers
from vacuula_server.gen4 import init as gen4_init
from vacuula_server.models.robot import Robot
from vacuula_server.gen4.data import Gen4Data
from vacuula_server.models.persistent_map import FloorPlan
from vacuula_server.models.run import Gen4__Run
from vacuula_server.db import get_session
from vacuula_server.state import pending_requests, robot_connections, client_connections, PendingRequest


class MockSocket:
    def __init__(self, incoming_bytes=b""):
        self.rfile = io.BytesIO(incoming_bytes)
        self.wfile = io.BytesIO()
        self.closed = False

    def recv(self, n):
        return self.rfile.read(n)

    def sendall(self, data):
        self.wfile.write(data)

    def getpeername(self):
        return ("192.168.1.188", 54321)

    def settimeout(self, t):
        pass

    def close(self):
        self.closed = True


def test_recv_packet_and_send_packet():
    # Send packet
    mock_sock = MockSocket()
    gen4_handlers.send_packet(mock_sock, b"test_payload")
    sent = mock_sock.wfile.getvalue()
    assert len(sent) == 4 + len(b"test_payload")
    length = struct.unpack(">I", sent[:4])[0]
    assert length == len(b"test_payload")
    assert sent[4:] == b"test_payload"

    # Recv packet
    mock_recv_sock = MockSocket(sent)
    payload = gen4_init.recv_packet(mock_recv_sock)
    assert payload == b"test_payload"


def test_send_json_and_heartbeat():
    mock_sock = MockSocket()
    gen4_handlers.send_json(mock_sock, {"msg": "hello"})
    gen4_handlers.send_heartbeat(mock_sock)
    assert len(mock_sock.wfile.getvalue()) > 0


def test_robot_send_request_and_response():
    mock_sock = MockSocket()
    conn = RobotConn("2126LB01A14101917", Generation.GEN4, Gen4Conn(mock_sock))
    slot = PendingRequest()

    req_id, err = gen4_handlers.robot_send_request(conn, {"cmd": "status"}, slot)
    assert req_id is not None
    assert err is None
    assert req_id in pending_requests

    # Deliver response
    resp_msg = {
        "id": req_id,
        "code": 200,
        "body": {"state": 1, "action": 0, "details": {}},
    }
    gen4_handlers.robot_response(conn, resp_msg)
    assert slot.event.is_set()
    assert slot.status == 200
    assert slot.content == resp_msg


def test_robot_event_broadcasting():
    mock_sock = MockSocket()
    serial = "2126LB01A14101917"
    conn = RobotConn(serial, Generation.GEN4, Gen4Conn(mock_sock))

    import queue
    q = queue.Queue()
    client_connections.append({"serial": serial, "queue": q})

    try:
        event_msg = {
            "type": "event",
            "to": {"service": "peer.state"},
            "body": {"state": 2, "charge": 95},
        }
        gen4_handlers.robot_event(conn, event_msg)

        assert not q.empty()
        item = q.get()
        assert b"neato.gen4" in item
        assert b"peer.state" in item
    finally:
        client_connections.clear()


def test_maps_create(tmp_path, monkeypatch):
    import base64
    monkeypatch.setattr(gen4_handlers, "MAPS_DIR", tmp_path / "maps")
    serial = "2126LB01A14101917"
    mock_sock = MockSocket()
    conn = RobotConn(serial, Generation.GEN4, Gen4Conn(mock_sock))

    uuid_str = "map-uuid-999"
    dummy_bin = base64.b64encode(b"PGM_NZ_BINARY_DATA").decode()

    msg = {
        "to": {"service": "maps.create"},
        "body": {
            "rank_uuid": uuid_str,
            "map": {
                "rank_binary": dummy_bin,
                "real_binary": dummy_bin,
                "origin": {"x": 0.0, "y": 0.0},
            },
            "robot": {
                "base": {"x": 1.0, "y": 2.0, "dir": 0.0},
            },
            "started_by": "vacuula",
            "battery_consumed": 15,
            "runs": [{"id": 1}],
            "timing": {"start": "2026-11-03T10:00:00Z", "end": "2026-11-03T10:30:00Z"},
            "cleaning_complete": True,
        },
    }

    with patch("vacuula_server.gen4.handlers.parse_session") as mock_parse:
        mock_parse.return_value = (
            {
                "metadata": {"resolution": 40, "alignment": 0},
                "img_size": [100, 100],
            },
            None,
        )
        res_body, res_code = gen4_handlers.maps_create(conn, msg)
        assert res_code == 201

    with get_session() as session:
        fp = session.get(FloorPlan, uuid_str)
        assert fp is not None
        assert fp.robot == serial
        assert fp.resolution == 40

        run = session.get(Gen4__Run, uuid_str)
        assert run is not None
        assert run.cleaning_complete is True


def test_handle_login_and_robot_info_exchange():
    mock_sock = MockSocket()
    serial = "2126LB01A14101917"
    conn = RobotConn("<unknown>", Generation.GEN4, Gen4Conn(mock_sock))

    login_msg = {"serial": serial}

    # Simulate immediate response to info.robot
    def fake_send_request(rc, body, slot):
        slot.content = {
            "body": {
                "serial_number": "D9-LABEL-123",
                "model": "D9",
                "firmware": "1.2.3",
            }
        }
        slot.status = 200
        slot.event.set()
        return "info-req-id", None

    with patch("vacuula_server.gen4.handlers.robot_send_request", side_effect=fake_send_request):
        gen4_handlers.handle_login(conn, login_msg)

    assert conn.serial == serial
    assert serial in robot_connections

    with get_session() as session:
        r = session.get(Robot, serial)
        assert r is not None
        assert "D9-LABEL-123" in r.name
        g4 = session.get(Gen4Data, serial)
        assert g4 is not None
        assert g4.label_serial == "D9-LABEL-123"


def test_handle_robot_stream_processing():
    serial = "2126LB01A14101917"

    # Frame 1: heartbeat b"\x06"
    f1 = struct.pack(">I", 1) + b"\x06"
    # Frame 2: event
    evt_json = json.dumps({"type": "event", "to": {"service": "peer.state"}, "body": {"state": 1}}).encode()
    f2 = struct.pack(">I", len(evt_json)) + evt_json
    # Frame 3: close b"\x00"
    f3 = struct.pack(">I", 1) + b"\x00"

    mock_sock = MockSocket(f1 + f2 + f3)

    gen4_init.handle_robot(mock_sock, ("192.168.1.188", 54321))
    assert mock_sock.closed is True
