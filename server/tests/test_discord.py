import pytest
from unittest.mock import patch, MagicMock
from vacuula_server import discord
from vacuula_server.models.robot import Robot
from vacuula_server.db import get_session


def test_format_error_code():
    assert "Dust bin missing" in discord.format_error_code("dustbin_missing")
    assert "Laser sensor jammed" in discord.format_error_code("lds_jammed")
    assert discord.format_error_code("custom_weird_error") == "Custom Weird Error"
    assert discord.format_error_code(None) == "Unknown error"


def test_robot_name_resolution():
    serial = "test-robot-name-123"
    # Cached
    discord.set_cached_robot_name(serial, "My Speedy Bot")
    assert discord.get_robot_name(serial) == "My Speedy Bot"

    # From DB
    serial_db = "test-robot-name-456"
    discord._robot_name_cache.pop(serial_db, None)
    with get_session() as session:
        session.add(Robot(serial=serial_db, type="neato.gen4", name="Database Bot"))
        session.commit()
    assert discord.get_robot_name(serial_db) == "Database Bot"

    # Fallback to serial
    assert discord.get_robot_name("non-existent-serial") == "non-existent-serial"


def test_is_event_enabled():
    with patch("vacuula_server.discord.get_notification_settings") as mock_settings:
        mock_settings.return_value = {
            "enabled": True,
            "events": {"cleaning_completed": True, "error": False},
        }
        assert discord.is_event_enabled("cleaning_completed") is True
        assert discord.is_event_enabled("error") is False

        mock_settings.return_value = {"enabled": False, "events": {"cleaning_completed": True}}
        assert discord.is_event_enabled("cleaning_completed") is False


def test_send_test_notification():
    with patch("vacuula_server.discord.urllib.request.urlopen") as mock_url:
        mock_resp = MagicMock()
        mock_resp.status = 204
        mock_url.return_value.__enter__.return_value = mock_resp

        ok, msg = discord.send_test_notification("https://discord.com/api/webhooks/test")
        assert ok is True
        assert "delivered" in msg

    # Invalid webhook url
    ok, msg = discord.send_test_notification("not-a-valid-url")
    assert ok is False


def test_format_duration():
    start = "2026-11-03T10:00:00Z"
    end = "2026-11-03T10:45:30Z"
    dur = discord._format_duration(start, end)
    assert dur == "45m 30s"

    # Missing end or start
    assert discord._format_duration(None, end) == "Unknown"


def test_notify_consumable_worn():
    serial = "OPS123-consumable"
    discord.set_cached_robot_name(serial, "Sparkles")
    with patch("vacuula_server.discord.is_event_enabled", return_value=True):
        with patch("vacuula_server.discord.send_embed") as mock_embed:
            discord.notify_consumable_worn(serial, [
                {
                    "consumable": "filter",
                    "used_hours": 125.0,
                    "threshold_hours": 120.0,
                    "remaining_hours": 0.0,
                    "percent_remaining": 0.0,
                },
            ])
            mock_embed.assert_called_once()
            args, kwargs = mock_embed.call_args
            assert "Maintenance Reminder" in kwargs["title"]
            assert "Sparkles" in kwargs["description"]


def test_notify_robot_connection():
    serial = "OPS123-conn"
    discord.set_cached_robot_name(serial, "Sparkles")
    with patch("vacuula_server.discord.is_event_enabled", return_value=True):
        with patch("vacuula_server.discord.send_embed") as mock_embed:
            # First time connecting
            discord._connection_states.pop(serial, None)
            discord.notify_robot_connection(serial, connected=True)
            mock_embed.assert_called_once()
            assert "Online" in mock_embed.call_args[1]["title"]

            # Same state -> deduplicated
            mock_embed.reset_mock()
            discord.notify_robot_connection(serial, connected=True)
            mock_embed.assert_not_called()

            # Disconnect
            discord.notify_robot_connection(serial, connected=False)
            mock_embed.assert_called_once()
            assert "Offline" in mock_embed.call_args[1]["title"]


def test_notify_run_completed():
    serial = "OPS123-run"
    discord.set_cached_robot_name(serial, "Sparkles")
    with patch("vacuula_server.discord.is_event_enabled", return_value=True):
        with patch("vacuula_server.discord.send_embed") as mock_embed:
            # Gen 3 run
            discord.notify_run_completed(
                serial,
                {
                    "start_at": "2026-11-03T10:00:00Z",
                    "end_at": "2026-11-03T10:30:00Z",
                    "status": "completed",
                    "cleaned_area": 42.5,
                },
                gen="gen3",
            )
            mock_embed.assert_called_once()
            assert "Run Completed" in mock_embed.call_args[1]["title"]

            # Gen 4 run
            mock_embed.reset_mock()
            discord.notify_run_completed(
                serial,
                {
                    "timing": {"start": "2026-11-03T10:00:00Z", "end": "2026-11-03T10:30:00Z"},
                    "cleaning_complete": True,
                    "runs": [{"coverage": {"sqm": 35.0}}],
                },
                gen="gen4",
            )
            mock_embed.assert_called_once()
            assert "Run Completed" in mock_embed.call_args[1]["title"]


def test_notify_gen3_state_transitions():
    serial = "OPS123-state"
    discord.set_cached_robot_name(serial, "Sparkles")
    # Pre-seed initial state as idle
    discord._robot_states[serial] = {
        "high_level": "idle",
        "last_error": None,
        "last_alert": None,
        "last_battery": 100,
    }

    with patch("vacuula_server.discord.is_event_enabled", return_value=True):
        with patch("vacuula_server.discord.send_embed") as mock_embed:
            # Transition to State 2 = Busy (Cleaning started)
            discord.notify_gen3_state(serial, {
                "state": 2,
                "action": 1,
                "error": None,
                "details": {"charge": 90, "isDocked": False},
            })
            assert mock_embed.called
            assert "Cleaning Started" in mock_embed.call_args[1]["title"]

            # Transition to State 3 = Paused
            mock_embed.reset_mock()
            discord.notify_gen3_state(serial, {
                "state": 3,
                "action": 1,
                "error": None,
                "details": {"charge": 88, "isDocked": False},
            })
            assert mock_embed.called
            assert "Paused" in mock_embed.call_args[1]["title"]

            # Error state
            mock_embed.reset_mock()
            discord.notify_gen3_state(serial, {
                "state": 4,
                "action": 0,
                "error": "brush_stuck",
                "details": {"charge": 85, "isDocked": False},
            })
            assert mock_embed.called
            assert "Error" in mock_embed.call_args[1]["title"]
            assert "Brush is stuck" in mock_embed.call_args[1]["description"]


def test_notify_gen4_state_transitions():
    serial = "2126LB01A14101917"
    discord.set_cached_robot_name(serial, "Loki")
    # Pre-seed initial state as idle
    discord._robot_states[serial] = {
        "high_level": "idle",
        "last_error": None,
        "last_alert": None,
        "last_battery": 100,
    }

    with patch("vacuula_server.discord.is_event_enabled", return_value=True):
        with patch("vacuula_server.discord.send_embed") as mock_embed:
            # Transition to cleaning
            discord.notify_gen4_state(serial, {
                "to": {"service": "peer.state"},
                "body": {
                    "state": "cleaning",
                    "action": "cleaning",
                    "errors": None,
                    "details": {"charge": 100, "is_docked": False},
                },
            })
            assert mock_embed.called
            assert "Cleaning Started" in mock_embed.call_args[1]["title"]

            # Transition to docking
            mock_embed.reset_mock()
            discord.notify_gen4_state(serial, {
                "to": {"service": "peer.state"},
                "body": {
                    "state": "cleaning",
                    "action": "docking",
                    "errors": None,
                    "details": {"charge": 70, "is_docked": False},
                },
            })
            assert mock_embed.called
            assert "Returning to Dock" in mock_embed.call_args[1]["title"]


def test_notify_alerts_and_schedules():
    serial = "2126LB01A14101917"
    with patch("vacuula_server.discord.is_event_enabled", return_value=True):
        with patch("vacuula_server.discord.send_embed") as mock_embed:
            discord.notify_consumable_worn(serial, [{"consumable": "filter", "remaining_hours": 2.0, "percent_remaining": 5}])
            assert mock_embed.called
            assert "Maintenance" in mock_embed.call_args[1]["title"]

