import pytest
from unittest.mock import patch, MagicMock
from vacuula_server.orchestrator import start_clean_here, _cleanup_gen3_ephemeral, robot_connections


def test_start_clean_here_validation():
    # Serial not connected
    with patch.dict(robot_connections, {}, clear=True):
        st, res = start_clean_here("any-serial", {"map_id": "m1", "vertices": [[0, 0], [1, 0], [1, 1]]})
        assert st == 400
        assert "not connected" in res["error"]

    # Connected but missing map_id or < 3 vertices
    serial = "OPS12345-aabbccddeeff"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        st, res = start_clean_here(serial, {"map_id": "", "vertices": [[0, 0], [1, 0], [1, 1]]})
        assert st == 400
        assert "map_id" in res["error"]

        st, res = start_clean_here(serial, {"map_id": "m1", "vertices": [[0, 0], [1, 0]]})
        assert st == 400
        assert "at least 3" in res["error"]


def test_start_clean_here_gen3_happy_path():
    serial = "OPS12345-aabbccddeeff"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            # 1. getMapBoundaries
            # 2. setMapBoundaries (returns saved boundaries including clean here)
            # 3. startCleaning
            mock_send.side_effect = [
                (200, {"result": "ok", "data": {"boundaries": [
                    {"id": "nogo-1", "type": "polyline", "vertices": [[0.1, 0.1], [0.2, 0.2]], "name": "NoGo"}
                ]}}),
                (200, {"result": "ok", "data": {"boundaries": [
                    {"id": "target-uuid-123", "name": "__vacuula_clean_here__"}
                ]}}),
                (200, {"result": "ok"}),
            ]
            st, res = start_clean_here(
                serial,
                {
                    "map_id": "basement-map",
                    "vertices": [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]],
                    "mode": 2,
                },
            )
            assert st == 200
            assert res["started"] is True
            assert res["boundary_id"] == "target-uuid-123"

            # Verify setMapBoundaries payload sent to robot
            set_call = mock_send.call_args_list[1]
            set_payload = set_call[0][1]
            assert set_payload["cmd"] == "setMapBoundaries"
            boundaries = set_payload["params"]["boundaries"]
            assert len(boundaries) == 2  # Existing NoGo + temporary Clean Here polygon
            
            clean_here_zone = [b for b in boundaries if b.get("name") == "__vacuula_clean_here__"][0]
            assert clean_here_zone["type"] == "polygon"
            # Centroid calculation for [0.2, 0.2]..[0.4, 0.4] is [0.3, 0.3]
            assert clean_here_zone["relevancy"] == [0.3, 0.3]
            assert clean_here_zone["id"] is not None


def test_start_clean_here_gen3_not_on_charge_base_error():
    serial = "OPS12345-aabbccddeeff"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            # 1. getMapBoundaries -> ok
            # 2. setMapBoundaries -> ok (returns assigned boundary)
            # 3. startCleaning -> rejected with "not_on_charge_base"
            # 4. cleanup getMapBoundaries
            # 5. cleanup setMapBoundaries
            mock_send.side_effect = [
                (200, {"result": "ok", "data": {"boundaries": []}}),
                (200, {"result": "ok", "data": {"boundaries": [{"id": "clean-id", "name": "__vacuula_clean_here__"}]}}),
                (200, {"result": "not_on_charge_base"}),
                (200, {"result": "ok", "data": {"boundaries": [{"id": "clean-id", "name": "__vacuula_clean_here__"}]}}),
                (200, {"result": "ok"}),
            ]
            st, res = start_clean_here(
                serial,
                {
                    "map_id": "basement-map",
                    "vertices": [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]],
                },
            )
            assert st == 400
            assert "charge base" in res["error"]


def test_cleanup_gen3_ephemeral_preserves_relevancy_and_removes_clean_here():
    serial = "OPS12345-aabbccddeeff"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            mock_send.side_effect = [
                # getMapBoundaries
                (200, {"result": "ok", "data": {"boundaries": [
                    {"id": "zone-existing", "type": "polygon", "vertices": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]], "name": "Kitchen", "relevancy": [0.2333, 0.1667]},
                    {"id": "temp-clean-here", "type": "polygon", "vertices": [[0.5, 0.5], [0.6, 0.5], [0.6, 0.6]], "name": "__vacuula_clean_here__", "relevancy": [0.5667, 0.5333]},
                ]}}),
                # setMapBoundaries
                (200, {"result": "ok"}),
            ]

            _cleanup_gen3_ephemeral(serial, "basement-map")

            assert mock_send.call_count == 2
            cleanup_payload = mock_send.call_args_list[1][0][1]
            assert cleanup_payload["cmd"] == "setMapBoundaries"
            cleaned_bounds = cleanup_payload["params"]["boundaries"]
            assert len(cleaned_bounds) == 1
            assert cleaned_bounds[0]["name"] == "Kitchen"
            assert cleaned_bounds[0]["id"] == "zone-existing"
            assert cleaned_bounds[0]["relevancy"] == [0.2333, 0.1667]


def test_on_robot_state_updated_gen3_docking_action_triggers_cleanup():
    from vacuula_server.orchestrator import _on_robot_state_updated, _ephemeral_cleanups, _orch_lock
    import time

    serial = "OPS12345-aabbccddeeff"
    with _orch_lock:
        _ephemeral_cleanups[serial] = {
            "gen": "gen3",
            "map_id": "basement-map",
            "saw_busy": True,
            "started_at": time.monotonic() - 10.0,
        }

    with patch("vacuula_server.orchestrator._cleanup_gen3_ephemeral") as mock_cleanup, \
         patch("time.sleep"):
        # Robot docks: state 1 (idle), action 4 (docking), details.isDocked True
        snapshot = {
            "state": 1,
            "action": 4,
            "details": {"isDocked": True, "charge": 98},
        }
        _on_robot_state_updated(serial, snapshot)
        time.sleep(0.05)  # Allow background thread to run

        with _orch_lock:
            assert serial not in _ephemeral_cleanups
        mock_cleanup.assert_called_once_with(serial, "basement-map")


def test_on_robot_state_updated_gen4_docked_triggers_cleanup():
    from vacuula_server.orchestrator import _on_robot_state_updated, _ephemeral_cleanups, _orch_lock
    import time

    serial = "2126LB01A14101917"
    with _orch_lock:
        _ephemeral_cleanups[serial] = {
            "gen": "gen4",
            "map_id": "main-floor",
            "saw_busy": True,
            "started_at": time.monotonic() - 10.0,
        }

    with patch("vacuula_server.orchestrator.promote_gen4_floorplan") as mock_promote, \
         patch("time.sleep"):
        snapshot = {
            "state": "idle",
            "action": "docking",
            "details": {"is_docked": True, "charge": 100},
        }
        _on_robot_state_updated(serial, snapshot)
        time.sleep(0.05)

        with _orch_lock:
            assert serial not in _ephemeral_cleanups
        mock_promote.assert_called_once_with(serial, "main-floor", preserve_schedules=True)
