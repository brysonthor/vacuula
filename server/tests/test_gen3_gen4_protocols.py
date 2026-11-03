import pytest
from unittest.mock import MagicMock
from vacuula_server.gen3 import commands as gen3_cmd
from vacuula_server.gen4 import handlers as gen4_handlers
from vacuula_server.conn import RobotConn, Gen4Conn
from vacuula_server.generation import Generation
from vacuula_server.models.robot import Robot
from vacuula_server.gen3.data import Gen3Data
from vacuula_server.db import get_session
import struct
import json


def test_gen3_hmac_and_signing():
    sig = gen3_cmd.hmac_sha256("test-message", "test-secret")
    assert isinstance(sig, str)
    assert len(sig) == 64

    # Sign cmd with DB password
    serial = "OPS-sign-test"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="SignBot"))
        session.add(Gen3Data(robot=serial, password="supersecretpass", installed_with="1.1.0"))
        session.commit()

    signed = gen3_cmd.sign_cmd(serial, '{"cmd":"getRobotState"}')
    assert "|" in signed
    assert '{"cmd":"getRobotState"}' in signed

    # Missing robot returns empty string
    assert gen3_cmd.sign_cmd("unknown-bot", "test") == ""


def test_gen3_build_command_and_chunk():
    serial = "OPS-chunk-test"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="ChunkBot"))
        session.add(Gen3Data(robot=serial, password="secret", installed_with="1.1.0"))
        session.commit()

    req_id, msg = gen3_cmd.build_command(serial, {"cmd": "getRobotState"})
    assert req_id is not None
    assert isinstance(msg, bytes)

    mock_wfile = MagicMock()
    gen3_cmd.send_chunk(mock_wfile, b"data-bytes")
    assert mock_wfile.write.called
    assert mock_wfile.flush.called


def test_gen4_packet_framing():
    mock_sock = MagicMock()
    body = b"hello-packet"
    gen4_handlers.send_packet(mock_sock, body)

    expected = struct.pack(">I", len(body)) + body
    mock_sock.sendall.assert_called_with(expected)

    # send_json
    gen4_handlers.send_json(mock_sock, {"msg": "hi"})
    assert mock_sock.sendall.called

    # send_heartbeat
    gen4_handlers.send_heartbeat(mock_sock)
    assert mock_sock.sendall.called


def test_gen4_robot_send_request():
    mock_sock = MagicMock()
    rc = RobotConn(
        serial="2126LB-req",
        gen=Generation.GEN4,
        conn=Gen4Conn(socket=mock_sock),
    )

    req_id, err = gen4_handlers.robot_send_request(rc, {"ability": "state.show"})
    assert err is None
    assert req_id is not None
    assert mock_sock.sendall.called
