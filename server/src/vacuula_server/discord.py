from __future__ import annotations
import json
import logging
import os
import queue
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from vacuula_server.db import get_session
from vacuula_server.fork_db import get_notification_settings, pop_newly_worn_consumables
from vacuula_server.models.robot import Robot

logger = logging.getLogger(__name__)

DEFAULT_WEBHOOK_URL = ""
AVATAR_URL = "https://raw.githubusercontent.com/vacuula/vacuula/main/ha-addon/icon.png"

# Discord embed color palette
COLOR_GREEN = 0x2ECC71   # Cleaning started, run completed, robot online
COLOR_YELLOW = 0xF1C40F  # Paused
COLOR_BLUE = 0x3498DB    # Resumed, info
COLOR_PURPLE = 0x9B59B6  # Returning to dock
COLOR_TEAL = 0x1ABC9C    # Docked
COLOR_RED = 0xE74C3C     # Error, offline
COLOR_ORANGE = 0xE67E22  # Alert, incomplete run

ERROR_TRANSLATIONS = {
    "dustbin_missing": "Dust bin missing — please put it back in",
    "ui_error_dustbin_missing": "Dust bin missing — please put it back in",
    "dustbin_full": "Dust bin full — please empty it and clean filter",
    "ui_alert_dustbin_full": "Dust bin full — please empty it and clean filter",
    "dustbin_emptied": "Dust bin emptied",
    "bumper_stuck": "Bumper is stuck — check that it moves freely",
    "ui_error_bumper_stuck": "Bumper is stuck — check that it moves freely",
    "picked_up": "Robot was lifted — please place it back on the floor",
    "ui_error_picked_up": "Robot was lifted — please place it back on the floor",
    "gen_picked_up": "Robot was lifted — please place it back on the floor",
    "brush_overload": "Brush overloaded — check for tangles",
    "brush_stuck": "Brush is stuck — check for tangles",
    "UI_ERROR_BRUSH_STUCK": "Brush is stuck — check for tangles",
    "main_brush_stuck": "Main brush is stuck — check for tangles",
    "side_brush_overcurrent": "Side brush overloaded — check for tangles",
    "vacuum_stuck": "Suction motor blocked",
    "vacuum_slip": "Suction motor issue",
    "lw_hanging": "Left wheel off the ground — place robot on floor",
    "rw_hanging": "Right wheel off the ground — place robot on floor",
    "lw_jammed": "Left wheel jammed — check for obstructions",
    "rw_jammed": "Right wheel jammed — check for obstructions",
    "lds_jammed": "Laser sensor jammed — check it spins freely",
    "lds_deck_debris": "Debris on laser sensor — please wipe clean",
    "lds_stream_error": "Laser sensor error",
    "batt_low": "Battery low",
    "batt_base_no_power": "Charge base has no power",
    "batt_base_connect_fail": "Couldn't connect to charge base",
    "nav_no_path": "Path blocked — clear path for robot",
    "nav_no_exit": "Robot is trapped — clear a way out",
    "nav_robot_falling": "Drop detected — move robot away from edge",
    "nav_undocking_failed": "Couldn't leave the base",
    "unable_to_return_to_base": "Couldn't return to the base",
    "nav_floorplan_load_fail": "Floor plan failed to load",
    "nav_floorplan_localization_fail": "Floor plan navigation error — ensure base hasn't moved",
    "clean_completed_to_start": "Please return robot to base",
    "clean_incomplete_to_start": "Please return robot to base",
}

GEN3_ACTION_NAMES = {
    1: "House Cleaning",
    2: "Spot Cleaning",
    3: "Manual Cleaning",
    4: "Docking",
    5: "Diagnostic Test",
    6: "Suspended Cleaning",
    7: "Updating Software",
    8: "Copying Logs",
    9: "Recovering Location",
    11: "Map Cleaning",
    12: "Exploring Map",
    13: "Preparing Map",
    14: "Uploading Map",
    15: "Suspended Exploration",
}

_queue: queue.Queue[dict] = queue.Queue(maxsize=100)
_worker_thread: threading.Thread | None = None
_lock = threading.Lock()

# In-memory tracking
_robot_name_cache: dict[str, str] = {}
_robot_states: dict[str, dict[str, Any]] = {}
_connection_states: dict[str, bool] = {}


def get_webhook_url() -> str | None:
    try:
        settings = get_notification_settings()
        if not settings.get("enabled", True):
            return None
        url = str(settings.get("discord_webhook_url") or "").strip()
        return url if url else None
    except Exception:
        url = os.environ.get("DISCORD_WEBHOOK_URL", DEFAULT_WEBHOOK_URL).strip()
        return url if url else None


def is_event_enabled(category: str) -> bool:
    try:
        settings = get_notification_settings()
        if not settings.get("enabled", True):
            return False
        events = settings.get("events") or {}
        return bool(events.get(category, True))
    except Exception:
        return True


def format_error_code(code: str | None) -> str:
    if not code:
        return "Unknown error"
    if code in ERROR_TRANSLATIONS:
        return ERROR_TRANSLATIONS[code]
    code_lower = code.lower().strip()
    if code_lower in ERROR_TRANSLATIONS:
        return ERROR_TRANSLATIONS[code_lower]
    clean = code
    for prefix in ("ui_error_", "ui_alert_", "UI_ERROR_", "UI_ALERT_"):
        if clean.startswith(prefix):
            clean = clean[len(prefix):]
            break
    return clean.replace("_", " ").title()


def get_robot_name(serial: str) -> str:
    with _lock:
        if serial in _robot_name_cache:
            return _robot_name_cache[serial]

    name = serial
    try:
        with get_session() as session:
            robot = session.get(Robot, serial)
            if robot and robot.name:
                name = robot.name
    except Exception as e:
        logger.debug("Failed to lookup robot name for %s: %s", serial, e)

    with _lock:
        _robot_name_cache[serial] = name
    return name


def set_cached_robot_name(serial: str, name: str) -> None:
    with _lock:
        _robot_name_cache[serial] = name


def _discord_worker() -> None:
    while True:
        payload = _queue.get()
        webhook_url = get_webhook_url()
        if not webhook_url:
            _queue.task_done()
            continue

        try:
            body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                webhook_url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Vacuula-Notifier/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status not in (200, 204):
                    logger.warning("Discord webhook returned status %s", resp.status)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                try:
                    err_data = json.loads(e.read().decode("utf-8"))
                    retry_after = float(err_data.get("retry_after", 1.0))
                except Exception:
                    retry_after = 2.0
                logger.warning("Discord rate limit hit, backing off %.1fs", retry_after)
                time.sleep(retry_after)
                # Re-queue once
                try:
                    _queue.put_nowait(payload)
                except queue.Full:
                    pass
            else:
                logger.warning("Discord HTTP error %s: %s", e.code, e.reason)
        except Exception as e:
            logger.warning("Failed to send Discord notification: %s", e)
        finally:
            _queue.task_done()


def _ensure_worker_started() -> None:
    global _worker_thread
    with _lock:
        if _worker_thread is None or not _worker_thread.is_alive():
            _worker_thread = threading.Thread(
                target=_discord_worker,
                name="vacuula-discord-worker",
                daemon=True,
            )
            _worker_thread.start()


def send_embed(
    title: str,
    description: str,
    color: int,
    fields: list[dict[str, Any]] | None = None,
    footer: str = "Vacuula",
    category: str | None = None,
) -> None:
    if not get_webhook_url():
        return
    if category and not is_event_enabled(category):
        return

    _ensure_worker_started()

    embed: dict[str, Any] = {
        "title": title,
        "description": description,
        "color": color,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "footer": {"text": footer},
    }
    if fields:
        embed["fields"] = fields

    payload = {
        "username": "Vacuula",
        "avatar_url": AVATAR_URL,
        "embeds": [embed],
    }

    try:
        _queue.put_nowait(payload)
    except queue.Full:
        logger.warning("Discord notification queue full, dropping oldest notification")
        try:
            _queue.get_nowait()
            _queue.put_nowait(payload)
        except Exception:
            pass


def send_test_notification(webhook_url_override: str | None = None) -> tuple[bool, str]:
    """Synchronously dispatch a test embed to validate webhook configuration."""
    url = (webhook_url_override or "").strip() or (get_notification_settings().get("discord_webhook_url") or "").strip()
    if not url:
        return False, "No Discord webhook URL configured"
    if not (url.startswith("https://") or url.startswith("http://")):
        return False, "Webhook URL must start with http:// or https://"

    payload = {
        "username": "Vacuula",
        "avatar_url": AVATAR_URL,
        "embeds": [
            {
                "title": "🔔 Vacuula Test Notification",
                "description": "Your Discord webhook is connected and ready to receive robot updates.",
                "color": COLOR_TEAL,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "footer": {"text": "Vacuula"},
            }
        ],
    }
    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Vacuula-Notifier/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status in (200, 204):
                return True, "Test notification delivered"
            return False, f"Discord returned HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        return False, f"Discord HTTP {e.code}: {e.reason}"
    except Exception as e:
        return False, str(e)


CONSUMABLE_LABELS = {
    "filter": "Filter",
    "main_brush": "Main Brush",
    "side_brush": "Side Brush",
    "sensors": "Sensors",
}


def notify_consumable_worn(serial: str, items: list[dict[str, Any]]) -> None:
    if not items:
        return
    name = get_robot_name(serial)
    fields = [
        {
            "name": CONSUMABLE_LABELS.get(item["consumable"], item["consumable"]),
            "value": f"{item['remaining_hours']:.1f}h left ({item['percent_remaining']:.0f}%)",
            "inline": True,
        }
        for item in items
    ]
    send_embed(
        title="🛠️ Maintenance Reminder",
        description=f"**{name}** has consumables nearing or past their service interval.",
        color=COLOR_ORANGE,
        fields=fields,
        category="consumables",
    )


def notify_robot_connection(
    serial: str,
    connected: bool,
    robot_name: str | None = None,
    robot_type: str | None = None,
) -> None:
    """Notify when a robot connects (online) or disconnects (offline)."""
    with _lock:
        prev = _connection_states.get(serial)
        _connection_states[serial] = connected

    # If first time seeing this serial and it's disconnected, ignore (initial boot state)
    if prev is None and not connected:
        return

    # If state hasn't changed, ignore
    if prev == connected:
        return

    name = robot_name or get_robot_name(serial)
    if robot_name:
        set_cached_robot_name(serial, robot_name)

    type_str = "Neato Robot"
    if robot_type:
        if "gen3" in robot_type.lower():
            type_str = "Neato Gen 3 (Connected)"
        elif "gen4" in robot_type.lower():
            type_str = "Neato Gen 4 (D8/D9/D10)"
        else:
            type_str = robot_type

    if connected:
        send_embed(
            title="🟢 Robot Online",
            description=f"**{name}** has connected to Vacuula.",
            color=COLOR_GREEN,
            fields=[
                {"name": "Robot", "value": name, "inline": True},
                {"name": "Model", "value": type_str, "inline": True},
                {"name": "Serial", "value": f"`{serial}`", "inline": False},
            ],
            category="connectivity",
        )
    else:
        send_embed(
            title="🔴 Robot Offline",
            description=f"**{name}** disconnected from Vacuula.",
            color=COLOR_RED,
            fields=[
                {"name": "Robot", "value": name, "inline": True},
                {"name": "Model", "value": type_str, "inline": True},
                {"name": "Serial", "value": f"`{serial}`", "inline": False},
            ],
            category="connectivity",
        )


def _format_duration(start_iso: str | None, end_iso: str | None) -> str:
    if not start_iso or not end_iso:
        return "Unknown"
    try:
        t0 = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        secs = max(0, int((t1 - t0).total_seconds()))
        mins, s = divmod(secs, 60)
        hrs, m = divmod(mins, 60)
        if hrs > 0:
            return f"{hrs}h {m}m"
        return f"{m}m {s}s"
    except Exception:
        return "Unknown"


def notify_run_completed(serial: str, run_data: dict[str, Any], gen: str) -> None:
    """Send notification when a cleaning session map/run finishes and uploads."""
    name = get_robot_name(serial)

    area_m2 = 0.0
    duration_str = "Unknown"
    battery_info = "Unknown"
    status_str = "Completed"
    error_note = None

    if gen == "gen3":
        area_m2 = float(run_data.get("cleaned_area") or 0.0)
        start_at = run_data.get("start_at")
        end_at = run_data.get("end_at")
        duration_str = _format_duration(start_at, end_at)

        chg_start = run_data.get("run_charge_at_start")
        chg_end = run_data.get("run_charge_at_end")
        if chg_start is not None and chg_end is not None:
            battery_info = f"{chg_start}% → {chg_end}%"
        elif chg_end is not None:
            battery_info = f"{chg_end}%"

        raw_status = run_data.get("status", "complete")
        err = run_data.get("error")
        if err:
            status_str = "Incomplete"
            error_note = format_error_code(err)
        elif raw_status == "incomplete":
            status_str = "Incomplete"
        else:
            status_str = "Completed"

    elif gen == "gen4":
        timing = run_data.get("timing") or {}
        duration_str = _format_duration(timing.get("start"), timing.get("end"))

        runs = run_data.get("runs") or []
        if isinstance(runs, list) and len(runs) > 0:
            first_run = runs[0] if isinstance(runs[0], dict) else {}
            stats = first_run.get("stats") or {}
            area_m2 = float(stats.get("area") or 0.0)

        consumed = run_data.get("battery_consumed")
        if consumed is not None:
            battery_info = f"{consumed}% used"

        complete = run_data.get("cleaning_complete", True)
        status_str = "Completed" if complete else "Incomplete"

    sq_ft = area_m2 * 10.7639
    area_str = f"{area_m2:.1f} m² ({sq_ft:.0f} sq ft)" if area_m2 > 0 else "0 m²"

    fields = [
        {"name": "Cleaned Area", "value": area_str, "inline": True},
        {"name": "Duration", "value": duration_str, "inline": True},
        {"name": "Battery", "value": battery_info, "inline": True},
        {"name": "Status", "value": status_str, "inline": True},
    ]
    if error_note:
        fields.append({"name": "Reason", "value": error_note, "inline": False})

    color = COLOR_GREEN if status_str == "Completed" else COLOR_ORANGE
    title = "✨ Cleaning Run Completed" if status_str == "Completed" else "⚠️ Cleaning Incomplete"

    send_embed(
        title=title,
        description=f"**{name}** finished a cleaning session.",
        color=color,
        fields=fields,
        category="run_summary",
    )

    try:
        worn = pop_newly_worn_consumables(serial)
        if worn:
            notify_consumable_worn(serial, worn)
    except Exception as e:
        logger.debug("Consumable wear check failed for %s: %s", serial, e)


def notify_gen3_state(serial: str, decoded: dict[str, Any]) -> None:
    """Handle incoming state events for Neato Gen 3 robots."""
    payload = decoded.get("data") if isinstance(decoded.get("data"), dict) else decoded
    state = payload.get("state")
    action = payload.get("action")
    error = payload.get("error")
    alert = payload.get("alert")
    details = payload.get("details") or {}
    charge = details.get("charge")
    is_docked = details.get("isDocked")

    # High-level state mapping
    if state == 4 or error:
        current_hl = "error"
    elif state == 3:
        current_hl = "paused"
    elif action == 4:
        current_hl = "docking"
    elif action in (1, 2, 3, 11):
        current_hl = "cleaning"
    elif is_docked or state == 1:
        current_hl = "docked" if is_docked else "idle"
    else:
        current_hl = "unknown"

    action_label = GEN3_ACTION_NAMES.get(action, "Cleaning") if action else "Cleaning"
    _process_state_transition(
        serial=serial,
        current_hl=current_hl,
        action_label=action_label,
        battery=charge,
        error=error,
        alert=alert,
    )


def notify_gen4_state(serial: str, event_msg: dict[str, Any]) -> None:
    """Handle incoming event packets for Neato Gen 4 robots."""
    service = event_msg.get("to", {}).get("service")

    if service == "peer.state":
        body = event_msg.get("body") or {}
        state = str(body.get("state", "")).lower()
        action = str(body.get("action", "")).lower()
        details = body.get("details") or {}
        charge = details.get("charge")
        is_docked = details.get("is_docked")
        errors = body.get("errors")

        error_code = None
        if errors and isinstance(errors, list) and len(errors) > 0:
            first_err = errors[0]
            if isinstance(first_err, dict):
                error_code = first_err.get("code")

        if state == "error" or error_code:
            current_hl = "error"
        elif state == "paused":
            current_hl = "paused"
        elif action == "docking":
            current_hl = "docking"
        elif action == "cleaning":
            current_hl = "cleaning"
        elif is_docked or state == "idle":
            current_hl = "docked" if is_docked else "idle"
        else:
            current_hl = "unknown"

        action_label = "Cleaning"
        if action == "docking":
            action_label = "Docking"
        elif action == "diagnostic_test":
            action_label = "Diagnostic Test"

        _process_state_transition(
            serial=serial,
            current_hl=current_hl,
            action_label=action_label,
            battery=charge,
            error=error_code,
            alert=None,
        )

    elif service == "robots.error_codes":
        body = event_msg.get("body") or {}
        error_list = body.get("errors") or []
        if isinstance(error_list, list) and len(error_list) > 0:
            err = error_list[0]
            code = err.get("code") if isinstance(err, dict) else str(err)
            name = get_robot_name(serial)
            send_embed(
                title="⚠️ Robot Error",
                description=f"**{name}**: {format_error_code(code)}",
                color=COLOR_RED,
                fields=[
                    {"name": "Robot", "value": name, "inline": True},
                    {"name": "Error Code", "value": f"`{code}`", "inline": True},
                ],
                category="errors",
            )


def _process_state_transition(
    serial: str,
    current_hl: str,
    action_label: str,
    battery: int | None,
    error: str | None,
    alert: str | None,
) -> None:
    name = get_robot_name(serial)
    batt_str = f"{battery}%" if battery is not None else "Unknown"

    with _lock:
        prev = _robot_states.get(serial)
        if prev is None:
            # Initial state recording; don't trigger noisy transitions on boot
            _robot_states[serial] = {
                "high_level": current_hl,
                "last_error": error,
                "last_alert": alert,
                "last_battery": battery,
            }
            if current_hl == "error" and error:
                # If discovered already in error on boot, send warning
                send_embed(
                    title="⚠️ Robot Error",
                    description=f"**{name}**: {format_error_code(error)}",
                    color=COLOR_RED,
                    fields=[
                        {"name": "Robot", "value": name, "inline": True},
                        {"name": "Battery", "value": batt_str, "inline": True},
                        {"name": "Error Code", "value": f"`{error}`", "inline": False},
                    ],
                    category="errors",
                )
            return

        prev_hl = prev.get("high_level")
        prev_error = prev.get("last_error")
        prev_alert = prev.get("last_alert")

        # Update cache
        prev["high_level"] = current_hl
        prev["last_error"] = error
        prev["last_alert"] = alert
        if battery is not None:
            prev["last_battery"] = battery

    # 1. Error change
    if error and error != prev_error:
        send_embed(
            title="⚠️ Robot Error",
            description=f"**{name}**: {format_error_code(error)}",
            color=COLOR_RED,
            fields=[
                {"name": "Robot", "value": name, "inline": True},
                {"name": "Battery", "value": batt_str, "inline": True},
                {"name": "Error Code", "value": f"`{error}`", "inline": False},
            ],
            category="errors",
        )

    # 2. Alert change
    if alert and alert != prev_alert:
        send_embed(
            title="🔔 Robot Alert",
            description=f"**{name}**: {format_error_code(alert)}",
            color=COLOR_ORANGE,
            fields=[
                {"name": "Robot", "value": name, "inline": True},
                {"name": "Battery", "value": batt_str, "inline": True},
                {"name": "Alert", "value": f"`{alert}`", "inline": False},
            ],
            category="errors",
        )

    # 3. Transitions
    if prev_hl != current_hl:
        if prev_hl in ("idle", "docked", "unknown") and current_hl == "cleaning":
            send_embed(
                title="🧹 Cleaning Started",
                description=f"**{name}** started {action_label.lower()}.",
                color=COLOR_GREEN,
                fields=[
                    {"name": "Robot", "value": name, "inline": True},
                    {"name": "Action", "value": action_label, "inline": True},
                    {"name": "Battery", "value": batt_str, "inline": True},
                ],
                category="cleaning",
            )
        elif prev_hl == "cleaning" and current_hl == "paused":
            send_embed(
                title="⏸️ Cleaning Paused",
                description=f"**{name}** was paused.",
                color=COLOR_YELLOW,
                fields=[
                    {"name": "Robot", "value": name, "inline": True},
                    {"name": "Battery", "value": batt_str, "inline": True},
                ],
                category="cleaning",
            )
        elif prev_hl == "paused" and current_hl == "cleaning":
            send_embed(
                title="▶️ Cleaning Resumed",
                description=f"**{name}** resumed cleaning.",
                color=COLOR_BLUE,
                fields=[
                    {"name": "Robot", "value": name, "inline": True},
                    {"name": "Battery", "value": batt_str, "inline": True},
                ],
                category="cleaning",
            )
        elif prev_hl in ("cleaning", "paused") and current_hl == "docking":
            send_embed(
                title="🏠 Returning to Dock",
                description=f"**{name}** is heading back to the base.",
                color=COLOR_PURPLE,
                fields=[
                    {"name": "Robot", "value": name, "inline": True},
                    {"name": "Battery", "value": batt_str, "inline": True},
                ],
                category="cleaning",
            )
        elif prev_hl in ("docking", "cleaning") and current_hl == "docked":
            send_embed(
                title="🔋 Docked at Base",
                description=f"**{name}** is safely back on the dock.",
                color=COLOR_TEAL,
                fields=[
                    {"name": "Robot", "value": name, "inline": True},
                    {"name": "Battery", "value": batt_str, "inline": True},
                ],
                category="cleaning",
            )
