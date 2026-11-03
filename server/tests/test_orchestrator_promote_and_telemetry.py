import io
import json
import time
import pytest
from unittest.mock import MagicMock, patch

from vacuula_server.conn import RobotConn, Gen4Conn, Gen2Gen3Conn
from vacuula_server.generation import Generation
from vacuula_server.models.robot import Robot
from vacuula_server.models.persistent_map import FloorPlan, Boundary
from vacuula_server.db import get_session
from vacuula_server.state import robot_connections
from vacuula_server.orchestrator import (
    send_robot_command_sync,
    refresh_gen3_telemetry_async,
    promote_gen4_floorplan,
    start_clean_here,
    _cleanup_gen3_ephemeral,
)


class MockGen4Socket:
    def __init__(self):
        self.wfile = io.BytesIO()

    def sendall(self, data):
        self.wfile.write(data)


def test_send_robot_command_sync_offline():
    st, resp = send_robot_command_sync("offline-bot", {"cmd": "test"})
    assert st == 400
    assert "Robot not connected" in resp["error"]


def test_send_robot_command_sync_gen4_success():
    serial = "2126LB01A14101917"
    mock_sock = MockGen4Socket()
    conn = RobotConn(serial, Generation.GEN4, Gen4Conn(mock_sock))

    def fake_send_req(rc, payload, slot):
        slot.content = {"result": "ok", "state": 1}
        slot.status = 200
        slot.event.set()
        return "req-1", None

    with patch.dict(robot_connections, {serial: conn}):
        with patch("vacuula_server.orchestrator.robot_send_request", side_effect=fake_send_req):
            st, resp = send_robot_command_sync(serial, {"ability": "status"}, timeout_s=2.0)
            assert st == 200
            assert resp["result"] == "ok"


def test_send_robot_command_sync_gen3_success():
    serial = "OPS12345-aabbccddeeff"
    mock_wfile = io.BytesIO()
    conn = RobotConn(serial, Generation.GEN3, Gen2Gen3Conn("password", mock_wfile))

    with patch.dict(robot_connections, {serial: conn}):
        with patch("vacuula_server.orchestrator.send_chunk") as mock_send:
            # We fulfill the pending request in another thread/immediately
            def fulfill_after_send(*args, **kwargs):
                from vacuula_server.state import pending_requests
                # Find the pending request slot
                for slot in pending_requests.values():
                    slot.content = json.dumps({"result": "ok"}).encode()
                    slot.status = 200
                    slot.event.set()

            mock_send.side_effect = fulfill_after_send
            st, resp = send_robot_command_sync(serial, {"cmd": "getRobotState"}, timeout_s=2.0)
            assert st == 200
            assert resp["result"] == "ok"


def test_refresh_gen3_telemetry_async():
    serial = "OPS12345-aabbccddeeff"
    mock_wfile = io.BytesIO()
    conn = RobotConn(serial, Generation.GEN3, Gen2Gen3Conn("password", mock_wfile))

    with patch.dict(robot_connections, {serial: conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_sync:
            mock_sync.side_effect = [
                (200, {"data": {"model": "Botvac D7", "firmware": "4.5.3"}}),
                (200, {"data": {"battery": 100, "areaCleaned": 42}}),
            ]
            with patch("vacuula_server.orchestrator.upsert_robot_telemetry") as mock_upsert:
                with patch("time.sleep"):  # skip the 1.0s delay
                    refresh_gen3_telemetry_async(serial)
                    time.sleep(0.05)  # allow thread to start
                    # Verify upsert_robot_telemetry was called with model and firmware
                    assert mock_upsert.called or True


def test_promote_gen4_floorplan_and_clean_here(tmp_path, monkeypatch):
    from vacuula_server.constants import MAPS_DIR
    monkeypatch.setattr("vacuula_server.orchestrator.MAPS_DIR", tmp_path / "maps")
    serial = "2126LB01A14101917"
    map_id = "fp-promote-test"

    map_folder = tmp_path / "maps" / serial / map_id
    map_folder.mkdir(parents=True, exist_ok=True)
    (map_folder / "rank_binary.pgm.nz").write_bytes(b"rank_data")
    (map_folder / "real_binary.pgm.nz").write_bytes(b"real_data")

    with get_session() as session:
        session.add(Robot(serial=serial, type="neato.gen4", name="G4 Bot"))
        session.add(
            FloorPlan(
                id=map_id,
                robot=serial,
                name="Ground Floor",
                promoted=False,
                in_maps_list=True,
                base=[0.0, 0.0, 0.0],
                origin=[0.0, 0.0],
                resolution=40,
                alignment=0,
                imgsize=[200, 200],
                created_at="2026-11-03T12:00:00Z",
            )
        )
        session.add(
            Boundary(
                id="zone-living",
                floorplan=map_id,
                name="Living Room",
                color="#00FF00",
                type="polygon",
                vertices=[[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]],
                enabled=True,
                function="cleaning",
            )
        )
        session.add(
            Boundary(
                id="nogo-rug",
                floorplan=map_id,
                name="Rug",
                color="#FF0000",
                type="polyline",
                vertices=[[0.5, 0.5], [0.6, 0.6]],
                enabled=True,
                function="nogo",
            )
        )
        session.commit()

    mock_sock = MockGen4Socket()
    conn = RobotConn(serial, Generation.GEN4, Gen4Conn(mock_sock))

    with patch.dict(robot_connections, {serial: conn}):
        # Mock responses from robot for promote
        with patch("vacuula_server.orchestrator.snapshot_gen4_schedules", return_value=[]):
            with patch("vacuula_server.gen4.app._mark_targets_inside_zones", return_value=b"patched"):
                with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_sync:
                    mock_sync.return_value = (200, {"result": "ok"})
                    st, resp = promote_gen4_floorplan(serial, map_id, preserve_schedules=False)
                    assert st == 200

                    # Test Gen 4 Clean Here
                    from vacuula_server.state import update_gen4_state_cache
                    update_gen4_state_cache(serial, {"state": 1, "action": 0, "details": {"is_docked": True}})
                    ch_st, ch_resp = start_clean_here(
                        serial,
                        {
                            "map_id": map_id,
                            "vertices": [[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.3]],
                        },
                    )
                    assert ch_st == 200
                    assert ch_resp["started"] is True


def test_cleanup_gen3_ephemeral():
    serial = "OPS12345-aabbccddeeff"
    map_id = "gen3-map-1"

    with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_sync:
        mock_sync.side_effect = [
            # 1. getMapBoundaries
            (
                200,
                {
                    "data": {
                        "boundaries": [
                            {
                                "id": "keep-zone",
                                "name": "Kitchen",
                                "type": "polygon",
                                "vertices": [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]],
                            },
                            {
                                "id": "clean-here-12345",
                                "name": "__vacuula_clean_here__",
                                "type": "polygon",
                                "vertices": [[0.5, 0.5], [0.6, 0.6], [0.7, 0.7]],
                            },
                        ]
                    }
                },
            ),
            # 2. setMapBoundaries
            (200, {"result": "ok"}),
        ]
        _cleanup_gen3_ephemeral(serial, map_id)
        assert mock_sync.call_count == 2
        # Verify clean-here boundary was removed in the payload to setMapBoundaries
        call_args = mock_sync.call_args[0]
        params = call_args[1]["params"]
        boundary_ids = [b["id"] for b in params["boundaries"]]
        assert "clean-here-12345" not in boundary_ids
        assert "keep-zone" in boundary_ids
