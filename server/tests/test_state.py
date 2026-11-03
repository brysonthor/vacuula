import pytest
import queue
from vacuula_server import state
from vacuula_server.state import (
    PendingRequest,
    register_state_listener,
    _fire_state_listeners,
    update_gen3_state_cache,
    update_gen4_state_cache,
    extract_fleet_summary,
    get_cached_state_gen3,
    get_cached_state_gen4,
    put_drop_oldest,
)


def test_pending_request():
    req = PendingRequest()
    assert not req.event.is_set()
    req.fulfill({"result": "ok"}, 200)
    assert req.event.is_set()
    assert req.content == {"result": "ok"}
    assert req.status == 200


def test_state_listeners():
    called = []

    def my_listener(serial, snap):
        called.append((serial, snap))

    register_state_listener(my_listener)
    _fire_state_listeners("test-serial", {"status": "ok"})
    assert len(called) >= 1
    assert called[-1] == ("test-serial", {"status": "ok"})


def test_gen3_state_cache_and_summary():
    serial = "OPS111-state"
    payload = {
        "state": 2, # Busy
        "action": 1, # House cleaning
        "error": None,
        "details": {"charge": 80, "isDocked": False, "isCharging": False},
        "availableCommands": {"pause": True, "stop": True},
        "meta": {"modelName": "BotVacD3Connected", "firmware": "4.5.3"},
    }
    update_gen3_state_cache(serial, payload)

    cached = get_cached_state_gen3(serial, req_id="1")
    assert cached["state"] == 2
    assert cached["reqId"] == "1"

    summary = extract_fleet_summary(serial, "neato.gen3")
    assert summary["charge"] == 80
    assert summary["is_docked"] is False
    assert summary["state_label"] == "cleaning"
    assert summary["has_error"] is False


def test_gen4_state_cache_and_summary():
    serial = "2126LB-state"
    body = {
        "state": "idle",
        "action": "invalid",
        "details": {"charge": 100, "is_docked": True, "is_charging": False},
        "available_commands": {"start": True},
    }
    update_gen4_state_cache(serial, body)

    cached = get_cached_state_gen4(serial, req_id="2")
    assert cached["body"]["state"] == "idle"

    summary = extract_fleet_summary(serial, "neato.gen4")
    assert summary["charge"] == 100
    assert summary["is_docked"] is True
    assert summary["state_label"] == "docked"
    assert summary["has_error"] is False


def test_extract_fleet_summary_with_errors():
    serial = "OPS-error"
    payload = {
        "state": 4, # Error
        "action": 0,
        "error": "brush_stuck",
        "details": {"charge": 45, "isDocked": False},
    }
    update_gen3_state_cache(serial, payload)
    summary = extract_fleet_summary(serial, "neato.gen3")
    assert summary["has_error"] is True
    assert summary["error_code"] == "brush_stuck"
    assert summary["state_label"] == "error"


def test_put_drop_oldest():
    q = queue.Queue(maxsize=2)
    put_drop_oldest(q, b"msg1")
    put_drop_oldest(q, b"msg2")
    assert q.qsize() == 2

    # Overflow should drop oldest (msg1)
    put_drop_oldest(q, b"msg3")
    assert q.qsize() == 2
    assert q.get_nowait() == b"msg2"
    assert q.get_nowait() == b"msg3"
