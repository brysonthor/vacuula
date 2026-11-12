import pytest
from unittest.mock import patch, MagicMock
from vacuula_server.handlers import app as app_handlers
from vacuula_server.models.robot import Robot
from vacuula_server.models.persistent_map import PersistentMap, FloorPlan
from vacuula_server.models.run import Gen3__Run, Gen4__Run
from vacuula_server.db import get_session
from vacuula_server.generation import Generation
from vacuula_server.conn import Gen2Gen3Conn
from vacuula_server.state import robot_connections, pending_requests


class DummyRequest:
    def __init__(self, body=None, path="/api/test"):
        self._body = body
        self.path = path
        self.command = "GET"
        self.status = 200
        self.data = None
        self.error_msg = None

    def read_json(self):
        return self._body

    def send_ok(self, data=None, close=True):
        self.status = 200
        self.data = data

    def send_response_data(self, data=None, close=True, status=200):
        self.status = status
        self.data = data

    def send_bad_request(self, message="Bad Request"):
        self.status = 400
        self.error_msg = message

    def send_not_found(self, message="Not Found"):
        self.status = 404
        self.error_msg = message

    def send_internal_error(self, message="Internal Error"):
        self.status = 500
        self.error_msg = message


def test_get_server_info():
    req = DummyRequest()
    app_handlers.get_server_info(req)
    assert req.status == 200
    assert "version" in req.data
    assert "timezone" in req.data
    assert "utc_offset_minutes" in req.data
    assert "uptime" in req.data
    assert "started_at" in req.data
    assert isinstance(req.data["uptime"], int)
    assert req.data["uptime"] >= 0
    assert isinstance(req.data["started_at"], str)


def test_get_robots():
    serial = "OPS999-robot-snap"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="SnapBot"))
        session.commit()

    req = DummyRequest()
    app_handlers.get_robots(req)
    assert req.status == 200
    assert isinstance(req.data, dict)
    assert serial in req.data
    assert req.data[serial]["name"] == "SnapBot"


def test_get_and_post_maps():
    gen3_serial = "OPS333-maps"
    gen4_serial = "2126LB01A14109999"

    with get_session() as session:
        session.add(Robot(serial=gen3_serial, type="neato.gen3", name="G3 Maps"))
        session.add(Robot(serial=gen4_serial, type="neato.gen4", name="G4 Maps"))
        session.add(PersistentMap(
            id="map-g3-1",
            robot=gen3_serial,
            name="G3 Basement",
            in_maps_list=True,
            base=[0.5, 0.5],
            enabled=True,
        ))
        session.add(FloorPlan(
            id="map-g4-1",
            robot=gen4_serial,
            name="G4 Main",
            in_maps_list=True,
            base=[0.4, 0.4, 0.0],
            origin=[0, 0],
            resolution=40.0,
            alignment=0.0,
            imgsize=[1000, 1000],
            promoted=True,
            created_at="2026-11-03T00:00:00Z",
        ))
        session.commit()

    # Get Gen 3 maps
    req_g3 = DummyRequest()
    app_handlers.get_maps(req_g3, gen3_serial)
    assert req_g3.status == 200
    assert len(req_g3.data) >= 1
    assert req_g3.data[0]["id"] == "map-g3-1"

    # Get Gen 4 maps
    req_g4 = DummyRequest()
    app_handlers.get_maps(req_g4, gen4_serial)
    assert req_g4.status == 200
    assert len(req_g4.data) >= 1
    assert req_g4.data[0]["id"] == "map-g4-1"

    # Post map update
    req_post = DummyRequest(body={"name": "Renamed Map", "enabled": True})
    app_handlers.post_map(req_post, gen3_serial, "map-g3-1")
    assert req_post.status == 200

    # Post map missing params
    req_bad = DummyRequest(body={"name": "Only Name"})
    app_handlers.post_map(req_bad, gen3_serial, "map-g3-1")
    assert req_bad.status == 400


def test_post_robot():
    serial = "OPS444-rename"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="Old Name"))
        session.commit()

    req = DummyRequest(body={"name": "New Name"})
    with patch("vacuula_server.handlers.app.notify_robots_changed"):
        app_handlers.post_robot(req, serial)
        assert req.status == 200

    with get_session() as session:
        bot = session.get(Robot, serial)
        assert bot.name == "New Name"

    # Bad request missing name
    req_bad = DummyRequest(body={"other_field": 123})
    app_handlers.post_robot(req_bad, serial)
    assert req_bad.status == 400


def test_get_runs():
    gen3_serial = "OPS555-runs"
    with get_session() as session:
        session.add(Robot(serial=gen3_serial, type="neato.gen3", name="Runner"))
        session.add(Gen3__Run(
            id="run-test-1",
            robot=gen3_serial,
            run={"clean_zone": "all"},
        ))
        session.commit()

    req = DummyRequest()
    app_handlers.get_runs(req, gen3_serial)
    assert req.status == 200
    assert len(req.data) >= 1
    assert req.data[0]["id"] == "run-test-1"


def test_connect_robot_not_found():
    req = DummyRequest()
    app_handlers.connect_robot(req, "non-existent-serial")
    assert req.status == 404


def test_post_robot_command_sanitizes_gen3_clean_here():
    serial = "OPS777-cleanbounds"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="BoundBot"))
        session.commit()

    mock_conn = MagicMock()
    mock_conn.gen = Generation.GEN3
    mock_conn.conn = MagicMock(spec=Gen2Gen3Conn)
    mock_conn.conn.wfile = MagicMock()

    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.handlers.app.build_command", return_value=("req-101", b"cmd")), \
             patch("vacuula_server.handlers.app.send_chunk"), \
             patch("vacuula_server.orchestrator._cleanup_gen3_ephemeral") as mock_cleanup:

            # Create dummy request for getMapBoundaries
            req = DummyRequest(body={"cmd": "getMapBoundaries", "params": {"mapId": "map-1"}})

            # Simulate pending request fulfill
            def fake_wait(*args, **kwargs):
                slot = pending_requests.get("req-101")
                if slot:
                    slot.fulfill({
                        "version": 1,
                        "result": "ok",
                        "data": {
                            "boundaries": [
                                {"id": "b1", "name": "Kitchen", "type": "polygon"},
                                {"id": "b2", "name": "__vacuula_clean_here__", "type": "polygon"},
                            ]
                        }
                    }, 200)

            with patch("threading.Event.wait", side_effect=fake_wait):
                app_handlers.post_robot_command(req, serial)

            assert req.status == 200
            bounds = req.data["data"]["boundaries"]
            assert len(bounds) == 1
            assert bounds[0]["name"] == "Kitchen"
            # Stale cleanup should be triggered
            import time
            time.sleep(0.05)
            mock_cleanup.assert_called_once_with(serial, "map-1")


def test_get_map_and_get_run(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr("vacuula_server.handlers.app.MAPS_DIR", tmp_path / "maps")
    serial = "OPS888-getmap"
    map_id = "test-map-xyz"

    map_folder = tmp_path / "maps" / serial / map_id
    map_folder.mkdir(parents=True, exist_ok=True)
    (map_folder / "floormap.json").write_text(json.dumps({"width": 500, "height": 500}))
    (map_folder / "runmap.json").write_text(json.dumps({"cleaned_area": 25.5}))

    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="MapBot"))
        session.add(PersistentMap(id=map_id, robot=serial, name="Test Map", base=[0.5, 0.5], enabled=True, in_maps_list=True))
        session.commit()

    req_map = DummyRequest()
    app_handlers.get_map(req_map, serial, map_id)
    assert req_map.status == 200
    assert req_map.data["in_maps_list"] is True
    assert req_map.data["base"] == [0.5, 0.5]

    req_run = DummyRequest()
    app_handlers.get_run(req_run, serial, map_id)
    assert req_run.status == 200
    assert req_run.data["cleaned_area"] == 25.5


def test_connect_robot_sse_stream():
    serial = "OPS888-sse"
    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen3", name="SSE Bot"))
        session.commit()

    import io
    req = DummyRequest()
    req.wfile = io.BytesIO()
    req.wfile.flush = MagicMock()
    req.send_response = MagicMock()
    req.send_header = MagicMock()
    req.end_headers = MagicMock()

    # Simulate client disconnect on first write
    req.wfile.write = MagicMock(side_effect=BrokenPipeError())

    app_handlers.connect_robot(req, serial)
    assert req.send_response.called

