import pytest
from unittest.mock import MagicMock
from vacuula_server.handlers import events
from vacuula_server.models.robot import Robot
from vacuula_server.db import get_session
from vacuula_server.generation import get_robot_by_serial, Generation
from vacuula_server.conn import RobotConn, Gen2Gen3Conn, Gen4Conn
from vacuula_server import env, constants


def test_robots_snapshot():
    serial = "OPS-snap-bot"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="SnapshotBot"))
        session.commit()

    snap = events.robots_snapshot()
    assert isinstance(snap, dict)
    assert serial in snap
    assert snap[serial]["name"] == "SnapshotBot"
    assert snap[serial]["type"] == "neato.gen3"
    assert snap[serial]["connected"] is False
    assert snap[serial]["connected_at"] is None
    assert snap[serial]["uptime"] is None

    from vacuula_server.state import robot_connections
    rc = RobotConn(serial, Generation.GEN3, MagicMock(), connected_at=100.0)
    robot_connections[serial] = rc
    try:
        snap_connected = events.robots_snapshot()
        assert snap_connected[serial]["connected"] is True
        assert snap_connected[serial]["connected_at"] is not None
        assert isinstance(snap_connected[serial]["uptime"], int)
        assert snap_connected[serial]["uptime"] > 0
    finally:
        robot_connections.pop(serial, None)


def test_broadcast_and_notify_robots_changed():
    q = events.queue.Queue(maxsize=10)
    with events._lock:
        events._clients.append(q)

    try:
        events.broadcast("test_event", {"hello": "world"})
        assert not q.empty()
        frame = q.get_nowait().decode("utf-8")
        assert "event: test_event" in frame
        assert 'data: {"hello": "world"}' in frame

        # notify_robots_changed
        events.notify_robots_changed()
        frame2 = q.get_nowait().decode("utf-8")
        assert "event: robots" in frame2
    finally:
        with events._lock:
            if q in events._clients:
                events._clients.remove(q)


def test_generation_helpers():
    serial = "OPS-gen-bot"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="GenBot"))
        session.commit()

    found = get_robot_by_serial(serial)
    assert found is not None
    assert found.name == "GenBot"
    assert get_robot_by_serial("missing") is None

    assert Generation.GEN3.value == "gen3 (D3, D4, D5, D6, D7)"
    assert Generation.GEN4.value == "gen4 (D800, D8, D9, D10)"


def test_conn_structures():
    g3_conn = Gen2Gen3Conn(password="secret", wfile=MagicMock())
    assert g3_conn.password == "secret"

    r_conn = RobotConn(serial="OPS-1", gen=Generation.GEN3, conn=g3_conn)
    assert r_conn.serial == "OPS-1"
    assert r_conn.gen == Generation.GEN3
    assert not r_conn.stop_event.is_set()

    g4_conn = Gen4Conn(socket=MagicMock())
    r_conn4 = RobotConn(serial="2126LB", gen=Generation.GEN4, conn=g4_conn)
    assert r_conn4.gen == Generation.GEN4


def test_env_and_constants():
    assert constants.MINIMUM_INSTALLER_VERSION is not None
    assert constants.APP_VERSION is not None
    assert env.GEN3_PORT > 0
    assert env.GEN4_PORT > 0


def test_get_events_sse_stream():
    req = MagicMock()
    req.wfile = MagicMock()
    req.wfile.write.side_effect = BrokenPipeError("client gone")

    events.get_events(req)
    assert req.send_response.called
    assert req.send_header.called


def test_error_model():
    from vacuula_server.models.error import Error
    err = Error(
        id="err-1",
        robot="OPS-1",
        start_at=1000,
        end_at=2000,
        charge_at_start=100,
        charge_at_end=80,
        cleaned_area=12.5,
    )
    assert err.id == "err-1"
    assert err.cleaned_area == 12.5


