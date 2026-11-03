import pytest
from unittest.mock import patch, MagicMock
from vacuula_server.orchestrator import dock_robot, robot_connections


@pytest.fixture(autouse=True)
def mock_no_sleep():
    with patch("vacuula_server.orchestrator.time.sleep", return_value=None):
        yield


def test_dock_robot_not_connected():
    with patch.dict(robot_connections, {}, clear=True):
        status, resp = dock_robot("unknown-serial")
        assert status == 400
        assert resp["ok"] is False
        assert "not connected" in resp["error"]


def test_dock_robot_gen3_already_docked():
    serial = "OPS12345-aabbccddeeff"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            mock_send.return_value = (
                200,
                {
                    "details": {"isDocked": True},
                    "availableCommands": {"start": True},
                },
            )
            status, resp = dock_robot(serial)
            assert status == 200
            assert resp["ok"] is True
            assert resp["docked"] is True
            assert "already docked" in resp["message"]
            mock_send.assert_called_once_with(serial, {"cmd": "getRobotState"}, timeout_s=4.0)


def test_dock_robot_gen3_active_cleaning_pauses_and_docks():
    serial = "OPS12345-aabbccddeeff"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            # Sequence:
            # 1. getRobotState -> cleaning active, pause available
            # 2. pauseCleaning -> result ok
            # 3. getRobotState (polling) -> goToBase available
            # 4. sendToBase -> result ok
            mock_send.side_effect = [
                (200, {"details": {"isDocked": False}, "availableCommands": {"pause": True}}),
                (200, {"result": "ok"}),
                (200, {"details": {"isDocked": False}, "availableCommands": {"goToBase": True}}),
                (200, {"result": "ok"}),
            ]
            status, resp = dock_robot(serial)
            assert status == 200
            assert resp["ok"] is True
            assert resp["docking"] is True
            assert resp["message"] == "Returning to base"
            assert mock_send.call_count == 4
            calls = [c[0][1] for c in mock_send.call_args_list]
            assert calls[0] == {"cmd": "getRobotState"}
            assert calls[1] == {"cmd": "pauseCleaning"}
            assert calls[2] == {"cmd": "getRobotState"}
            assert calls[3] == {"cmd": "sendToBase"}


def test_dock_robot_gen3_spot_cleaning_stops_safely():
    serial = "OPS12345-aabbccddeeff"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            # Sequence:
            # 1. getRobotState -> pause available
            # 2. pauseCleaning -> result ok
            # 3. getRobotState -> cleaning.category == 3 (spot clean)
            # 4. stopCleaning -> result ok
            mock_send.side_effect = [
                (200, {"details": {"isDocked": False}, "availableCommands": {"pause": True}}),
                (200, {"result": "ok"}),
                (200, {
                    "cleaning": {"category": 3},
                    "details": {"dockHasBeenSeen": False},
                    "state": 3,
                    "availableCommands": {"resume": True},
                }),
                (200, {"result": "ok"}),
            ]
            status, resp = dock_robot(serial)
            assert status == 200
            assert resp["ok"] is True
            assert "no dock reference" in resp["message"]
            assert mock_send.call_args_list[-1][0][1] == {"cmd": "stopCleaning"}


def test_dock_robot_gen4_active_cleaning_pauses_and_returns_to_base():
    serial = "2126LB01A14101917"  # No dash -> Gen 4
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            # Sequence:
            # 1. state.show -> details.is_docked=False, available_commands.pause=True
            # 2. cleaning.pause -> 200
            # 3. state.show (polling) -> available_commands.return_to_base=True
            # 4. navigation.return_to_base -> 200
            mock_send.side_effect = [
                (200, {"details": {"is_docked": False}, "available_commands": {"pause": True}}),
                (200, {"result": "ok"}),
                (200, {"details": {"is_docked": False}, "available_commands": {"return_to_base": True}}),
                (200, {"result": "ok"}),
            ]
            status, resp = dock_robot(serial)
            assert status == 200
            assert resp["ok"] is True
            assert resp["docking"] is True
            assert resp["message"] == "Returning to base"
            calls = [c[0][1] for c in mock_send.call_args_list]
            assert calls[0] == {"ability": "state.show"}
            assert calls[1] == {"ability": "cleaning.pause"}
            assert calls[2] == {"ability": "state.show"}
            assert calls[3] == {"ability": "navigation.return_to_base"}
