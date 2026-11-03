import pytest
from unittest.mock import patch, MagicMock
from vacuula_server.manual_drive import (
    VALID_COMBOS,
    VALID_COMMANDS,
    drive_start,
    drive_input,
    drive_stop,
    drive_status,
)
from vacuula_server.state import robot_connections


def test_drive_validation_constants():
    assert "forward" in VALID_COMBOS
    assert "stop" in VALID_COMBOS
    assert "vacuum-on" in VALID_COMMANDS
    assert "eco-on" in VALID_COMMANDS


def test_drive_start_unsupported_gen4():
    # Serial without dash is Gen 4
    st, resp = drive_start("2126LB01A14101917")
    assert st == 400
    assert "Gen 3" in resp["error"]


def test_drive_start_offline_robot():
    with patch.dict(robot_connections, {}, clear=True):
        st, resp = drive_start("OPS123-offline")
        assert st == 400
        assert "offline" in resp["error"]


def test_drive_start_success():
    from vacuula_server.manual_drive import _DriveSession
    serial = "OPS123-startsuccess"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.manual_drive.send_robot_command_sync") as mock_send:
            mock_send.return_value = (
                200,
                {
                    "result": "ok",
                    "data": {
                        "ip_address": "192.168.1.77",
                        "port": 9090,
                        "ssid": "TestWiFi",
                    },
                },
            )
            with patch("vacuula_server.manual_drive._SimpleWSClient") as mock_ws_cls:
                mock_ws = MagicMock()
                mock_ws.connected = True
                mock_ws_cls.return_value = mock_ws

                with patch.object(_DriveSession, "start_loops"):
                    st, res = drive_start(serial)
                    assert st == 200
                    assert res["connected"] is True
                    assert res["ip_address"] == "192.168.1.77"
                    assert res["port"] == 9090

                    # Calling again reuses existing session
                    st2, res2 = drive_start(serial)
                    assert st2 == 200

                    drive_stop(serial)



def test_drive_input_no_session():
    st, resp = drive_input("OPS123-nosess", {"combo": "forward"})
    assert st == 400
    assert "No active manual drive session" in resp["error"]


def test_drive_stop_and_status_no_session():
    st_stat, resp_stat = drive_status("OPS123-nosess")
    assert st_stat == 200
    assert resp_stat["connected"] is False

    st_stop, resp_stop = drive_stop("OPS123-nosess")
    assert st_stop == 200
    assert resp_stop["stopped"] is True


def test_ws_client_frame_encode_and_decode():
    from vacuula_server.manual_drive import _SimpleWSClient
    import io

    # Mock socket with byte stream obeying recv(n)
    handshake = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
    frames = io.BytesIO(b"\x81\x05hello\x89\x04ping\x88\x00")
    first = True

    def mock_recv(n):
        nonlocal first
        if first:
            first = False
            return handshake
        return frames.read(n)

    mock_sock = MagicMock()
    mock_sock.recv.side_effect = mock_recv

    with patch("socket.create_connection", return_value=mock_sock):
        client = _SimpleWSClient("192.168.1.100", 8080)
        assert client.connected is True

        # Send text
        client.send_text("test")
        assert mock_sock.sendall.called

        # Send pong
        client.send_pong(b"ping")

        # Recv text frame
        op, data = client.recv_frame()
        assert op == 0x1
        assert data == b"hello"

        # Recv ping frame
        op, data = client.recv_frame()
        assert op == 0x9
        assert data == b"ping"

        # Recv close frame
        op, data = client.recv_frame()
        assert op == 0x8

        client.close()
        assert client.connected is False


def test_drive_session_commands_and_lifecycle():
    from vacuula_server.manual_drive import _DriveSession, drive_start, drive_input, drive_status, drive_stop, _sessions

    mock_ws = MagicMock()
    mock_ws.connected = True
    serial = "OPS123-activesess"

    sess = _DriveSession(serial, mock_ws, "192.168.1.50", 8080, "MyWiFi")
    
    # Test commands
    sess.send_command("vacuum-on")
    assert sess.vacuum_on is True
    sess.send_command("vacuum-off")
    assert sess.vacuum_on is False

    sess.send_command("brush-on")
    assert sess.brush_on is True
    sess.send_command("brush-off")
    assert sess.brush_on is False

    sess.send_command("eco-off")
    assert sess.eco_on is False
    sess.send_command("eco-on")
    assert sess.eco_on is True

    # Test combo
    sess.set_combo("forward")
    assert sess.active_combo == "forward"

    stat = sess.status_dict()
    assert stat["connected"] is True
    assert stat["ip_address"] == "192.168.1.50"
    assert stat["active_combo"] == "forward"

    # Drive API integration
    _sessions[serial] = sess
    try:
        # drive_status
        st, res = drive_status(serial)
        assert st == 200
        assert res["connected"] is True

        # Invalid combo
        st, res = drive_input(serial, {"combo": "fly_to_moon"})
        assert st == 400
        assert "Unsupported combo" in res["error"]

        # Valid combo
        st, res = drive_input(serial, {"combo": "pivot-left"})
        assert st == 200
        assert res["active_combo"] == "pivot-left"

        # Invalid command
        st, res = drive_input(serial, {"command": "self_destruct"})
        assert st == 400
        assert "Unsupported command" in res["error"]

        # Valid command
        st, res = drive_input(serial, {"command": "vacuum-on"})
        assert st == 200
        assert res["vacuum_on"] is True

        # drive_stop
        st, res = drive_stop(serial)
        assert st == 200
        assert res["stopped"] is True
    finally:
        sess.shutdown()


def test_drive_session_loops():
    from vacuula_server.manual_drive import _DriveSession
    mock_ws = MagicMock()
    mock_ws.connected = True
    serial = "OPS123-loops"
    sess = _DriveSession(serial, mock_ws, "192.168.1.50", 8080, "WiFi")

    # When stop event is set, loops exit immediately
    sess.stop_event.set()
    sess._tx_loop()
    sess._rx_loop()


