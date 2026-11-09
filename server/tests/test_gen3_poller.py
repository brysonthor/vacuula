from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from vacuula_server.conn import RobotConn
from vacuula_server.gen3 import poller
from vacuula_server.generation import Generation
from vacuula_server.state import robot_connections


@pytest.fixture(autouse=True)
def clean_poller_state():
    poller.stop_gen3_poller_thread()
    poller._last_polled.clear()
    robot_connections.clear()
    yield
    poller.stop_gen3_poller_thread()
    poller._last_polled.clear()
    robot_connections.clear()


def test_poll_robot_success():
    serial = "OPS11111-GEN3-TEST"
    with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
        mock_send.return_value = (200, {"state": 1, "action": 0})
        status, resp = poller.poll_robot(serial)
        assert status == 200
        assert resp == {"state": 1, "action": 0}
        mock_send.assert_called_once_with(serial, {"cmd": "getRobotState"}, timeout_s=10.0)


def test_poll_robot_handles_timeout():
    serial = "OPS11111-GEN3-TEST"
    with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
        mock_send.return_value = (504, {"error": "Robot did not answer in time"})
        status, resp = poller.poll_robot(serial)
        assert status == 504
        assert "error" in resp


def test_poll_all_gen3_robots_only_targets_gen3():
    gen3_serial = "OPS-GEN3-ROBOT"
    gen4_serial = "OPS-GEN4-ROBOT"

    robot_connections[gen3_serial] = RobotConn(gen3_serial, Generation.GEN3, MagicMock())
    robot_connections[gen4_serial] = RobotConn(gen4_serial, Generation.GEN4, MagicMock())

    with patch.object(poller, "poll_robot") as mock_poll:
        mock_poll.return_value = (200, {"state": 1})
        res = poller.poll_all_gen3_robots()

        assert gen3_serial in res
        assert gen4_serial not in res
        mock_poll.assert_called_once_with(gen3_serial, timeout_s=10.0)


def test_poller_tick_timing_and_cleanup():
    serial = "OPS-SPARKLES-01"
    robot_connections[serial] = RobotConn(serial, Generation.GEN3, MagicMock())

    # 1. First tick records connection time without immediately firing thread
    t0 = 1000.0
    with patch("time.monotonic", return_value=t0), patch.object(poller, "poll_robot") as mock_poll:
        poller._poller_tick(interval_s=180.0)
        assert poller._last_polled[serial] == 1000.0
        assert mock_poll.call_count == 0

    # 2. Before interval expires, tick does not fire
    with patch("time.monotonic", return_value=t0 + 100.0), patch.object(poller, "poll_robot") as mock_poll:
        poller._poller_tick(interval_s=180.0)
        assert mock_poll.call_count == 0

    # 3. After 180s expires, tick fires thread
    with patch("time.monotonic", return_value=t0 + 185.0), patch("threading.Thread") as mock_thread:
        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance

        poller._poller_tick(interval_s=180.0)
        assert poller._last_polled[serial] == t0 + 185.0
        mock_thread.assert_called_once()
        mock_thread_instance.start.assert_called_once()

    # 4. If robot disconnects, it is pruned from _last_polled on tick
    del robot_connections[serial]
    poller._poller_tick(interval_s=180.0)
    assert serial not in poller._last_polled


def test_start_and_stop_poller_thread(monkeypatch):
    monkeypatch.setattr(poller.env, "GEN3_POLL_INTERVAL", 180)
    poller.start_gen3_poller_thread()
    assert poller._poller_thread is not None
    assert poller._poller_thread.is_alive()

    # Calling start again doesn't create a new thread
    orig_thread = poller._poller_thread
    poller.start_gen3_poller_thread()
    assert poller._poller_thread is orig_thread

    poller.stop_gen3_poller_thread()
    assert poller._poller_thread is None


def test_start_poller_disabled(monkeypatch):
    monkeypatch.setattr(poller.env, "GEN3_POLL_INTERVAL", 0)
    poller.start_gen3_poller_thread()
    assert poller._poller_thread is None
