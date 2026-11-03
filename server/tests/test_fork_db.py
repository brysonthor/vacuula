import pytest
from datetime import datetime, timezone, timedelta
from vacuula_server.fork_db import (
    get_notification_settings,
    save_notification_settings,
    list_server_schedules,
    upsert_server_schedule,
    delete_server_schedule,
    mark_server_schedule_triggered,
    set_schedule_skip,
    get_schedule_skip,
    clear_schedule_skip,
    list_all_schedule_skips,
    get_consumables_status,
    reset_consumable,
    update_consumable_threshold,
    pop_newly_worn_consumables,
    upsert_robot_telemetry,
    get_robot_telemetry,
    get_all_robot_telemetry,
    purge_fork_robot_data,
    now_iso,
)
from vacuula_server.models.robot import Robot
from vacuula_server.models.run import Gen3__Run, Gen4__Run
from vacuula_server.db import get_session


def test_notification_settings_crud():
    settings = get_notification_settings()
    assert isinstance(settings, dict)
    assert "events" in settings

    updated = save_notification_settings({
        "discord_webhook_url": "https://discord.com/api/webhooks/123/abc",
        "enabled": True,
        "events": {"cleaning_completed": True, "error": True},
    })
    assert updated["discord_webhook_url"] == "https://discord.com/api/webhooks/123/abc"
    assert updated["enabled"] is True

    re_read = get_notification_settings()
    assert re_read["discord_webhook_url"] == "https://discord.com/api/webhooks/123/abc"
    assert re_read["enabled"] is True


def test_server_schedules_crud():
    serial = "test-robot-sched"
    item = upsert_server_schedule(
        serial=serial,
        data={
            "name": "Clean Kitchen Later",
            "schedule_type": "one_off",
            "run_at_iso": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
            "payload": {"category": 4, "boundaryId": "b-123"},
        },
    )
    sched_id = item["id"]
    assert sched_id is not None
    assert item["name"] == "Clean Kitchen Later"

    schedules = list_server_schedules(serial)
    assert any(s["id"] == sched_id for s in schedules)

    mark_server_schedule_triggered(sched_id, "2026-11-03 15:00", disable=True)
    schedules = list_server_schedules(serial)
    matched = [s for s in schedules if s["id"] == sched_id][0]
    assert matched["enabled"] is False
    assert matched["last_triggered_key"] == "2026-11-03 15:00"

    deleted = delete_server_schedule(serial, sched_id)
    assert deleted is True
    schedules = list_server_schedules(serial)
    assert not any(s["id"] == sched_id for s in schedules)


def test_schedule_skips_crud():
    serial = "test-robot-skip"
    until = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()
    restore_data = {"enabled": True, "events": [{"day": 1, "startTime": "09:00"}]}

    skip = set_schedule_skip(serial, until, native_restore_json=restore_data)
    assert skip["robot"] == serial
    assert skip["skip_until_iso"] == until

    fetched = get_schedule_skip(serial)
    assert fetched is not None
    assert fetched["robot"] == serial
    assert fetched["native_restore_json"] == restore_data

    all_skips = list_all_schedule_skips()
    assert any(s["robot"] == serial for s in all_skips)

    restored = clear_schedule_skip(serial)
    assert restored == restore_data
    assert get_schedule_skip(serial) is None


def test_consumables_and_runs():
    gen3_serial = "OPS11111-222233334444"
    gen4_serial = "2126LB01A14101917"

    with get_session() as session:
        session.add(Robot(serial=gen3_serial, type="neato.gen3", name="Gen3 Bot"))
        session.add(Robot(serial=gen4_serial, type="neato.gen4", name="Gen4 Bot"))
        
        # Gen 3 run: 1 hour (3600s)
        session.add(Gen3__Run(
            id="run-g3-1",
            robot=gen3_serial,
            run={"start_at": "2026-11-01T10:00:00Z", "end_at": "2026-11-01T11:00:00Z"},
        ))
        # Gen 4 run: 2 hours (7200s)
        session.add(Gen4__Run(
            id="run-g4-1",
            robot=gen4_serial,
            started_by="app",
            battery_consumed=40,
            cleaning_complete=True,
            timing={"start": "2026-11-02T10:00:00Z", "end": "2026-11-02T12:00:00Z"},
            runs=[],
        ))
        session.commit()

    # Gen 3 consumables status: 1.0 hr used
    status_g3 = get_consumables_status(gen3_serial)
    by_name_g3 = {item["consumable"]: item for item in status_g3}
    assert by_name_g3["filter"]["used_hours"] == 1.0

    # Gen 4 consumables status: 2.0 hrs used
    status_g4 = get_consumables_status(gen4_serial)
    by_name_g4 = {item["consumable"]: item for item in status_g4}
    assert by_name_g4["filter"]["used_hours"] == 2.0

    # Update threshold
    update_consumable_threshold(gen3_serial, "filter", 150.0)
    status_g3 = get_consumables_status(gen3_serial)
    by_name_g3 = {item["consumable"]: item for item in status_g3}
    assert by_name_g3["filter"]["threshold_hours"] == 150.0

    # Reset consumable
    reset_consumable(gen3_serial, "filter")
    status_g3 = get_consumables_status(gen3_serial)
    by_name_g3 = {item["consumable"]: item for item in status_g3}
    assert by_name_g3["filter"]["used_hours"] == 0.0

    # pop_newly_worn_consumables
    newly_worn = pop_newly_worn_consumables(gen3_serial)
    assert isinstance(newly_worn, list)


def test_robot_telemetry_crud():
    serial = "test-robot-telemetry"
    upsert_robot_telemetry(
        serial,
        ip_address="192.168.1.100",
        model="BotVacD7Connected",
        firmware="4.5.3",
        info_json={"battery": 95},
        touch_seen=True,
    )

    telem = get_robot_telemetry(serial)
    assert telem is not None
    assert telem["ip_address"] == "192.168.1.100"
    assert telem["model"] == "BotVacD7Connected"
    assert telem["firmware"] == "4.5.3"
    assert telem["info"]["battery"] == 95
    assert telem["last_seen_at"] is not None

    all_t = get_all_robot_telemetry()
    assert serial in all_t

    purge_fork_robot_data(serial)
    assert get_robot_telemetry(serial) is None
