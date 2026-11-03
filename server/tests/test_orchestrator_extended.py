import pytest
from unittest.mock import patch, MagicMock
from vacuula_server.orchestrator import (
    start_gen3_zone_queue,
    get_gen3_zone_queue,
    cancel_gen3_zone_queue,
    activate_skip_next_run,
    cancel_skip_next_run,
    _compute_next_occurrence,
    _scheduler_tick,
    robot_connections,
)
from datetime import datetime, timezone


def test_compute_next_occurrence():
    tz = timezone.utc
    now = datetime(2026, 11, 3, 10, 0, 0, tzinfo=tz) # A Tuesday (weekday 1)
    # Next Tuesday at 11:00 -> today + 1 hour
    nxt = _compute_next_occurrence(now, 1, "11:00")
    assert nxt is not None
    assert nxt.day == 3
    assert nxt.hour == 11

    # Next Monday (weekday 0) at 09:00 -> next week
    nxt_mon = _compute_next_occurrence(now, 0, "09:00")
    assert nxt_mon is not None
    assert nxt_mon.weekday() == 0
    assert nxt_mon > now


def test_gen3_zone_queue_lifecycle():
    serial = "OPS123-queue-flow"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            mock_send.return_value = (200, {"result": "ok"})

            # Start queue with 2 zones
            zones = [
                {"id": "zone-1", "name": "Kitchen", "mode": 2},
                {"id": "zone-2", "name": "Hallway", "mode": 1},
            ]
            st, res = start_gen3_zone_queue(serial, zones)
            assert st == 200
            assert res["started"] is True
            assert res["queue"]["total"] == 2
            assert res["queue"]["current_index"] == 0

            # Check queue state
            active_q = get_gen3_zone_queue(serial)
            assert active_q is not None
            assert active_q["status"] == "running"

            # Cancel queue
            cancelled = cancel_gen3_zone_queue(serial, stop_robot=True)
            assert cancelled["cancelled"] is True
            assert get_gen3_zone_queue(serial) is None


def test_activate_and_cancel_skip_next_run():
    serial = "OPS123-skip-flow"
    mock_conn = MagicMock()
    with patch.dict(robot_connections, {serial: mock_conn}):
        with patch("vacuula_server.orchestrator.send_robot_command_sync") as mock_send:
            # Native schedule on robot is enabled
            mock_send.side_effect = [
                (200, {"result": "ok", "data": {"enabled": True, "events": [{"day": 1, "startTime": "18:00"}]}}),
                (200, {"result": "ok"}), # disableSchedule
                (200, {"result": "ok"}), # enableSchedule on cancel
            ]

            st, res = activate_skip_next_run(serial)
            assert st == 200
            assert res["robot"] == serial
            assert res["skip_until_iso"] is not None

            st_c, res_c = cancel_skip_next_run(serial)
            assert st_c == 200
            assert res_c["cleared"] is True


def test_scheduler_tick():
    # _scheduler_tick runs clean and handles skips and one_off/recurring schedules
    with patch("vacuula_server.orchestrator.list_all_schedule_skips", return_value=[]):
        with patch("vacuula_server.orchestrator.list_server_schedules", return_value=[]):
            _scheduler_tick()


def test_advance_gen3_queue():
    from vacuula_server.orchestrator import _advance_gen3_queue_worker, _gen3_queues

    serial = "OPS123-advance-queue"
    queue_id = "q-test-123"
    _gen3_queues[serial] = {
        "id": queue_id,
        "serial": serial,
        "status": "running",
        "zones": [{"name": "Zone1"}, {"name": "Zone2"}],
        "current_index": 0,
        "total": 2,
    }

    try:
        with patch("time.sleep"):  # skip 5.0s delay
            with patch("vacuula_server.orchestrator._dispatch_gen3_zone", return_value=(True, None)):
                with patch("vacuula_server.orchestrator._broadcast_queue"):
                    _advance_gen3_queue_worker(serial, queue_id, next_idx=1)
                    q = _gen3_queues.get(serial)
                    assert q is not None
                    assert q["current_index"] == 1
                    assert q["status"] == "running"
    finally:
        _gen3_queues.pop(serial, None)

