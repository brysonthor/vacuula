from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, Float, String, JSON, select, delete
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from vacuula_server.db import engine, get_session
from vacuula_server.models.run import Gen3__Run, Gen4__Run

logger = logging.getLogger(__name__)


class ForkBase(DeclarativeBase):
    """Separate SQLAlchemy declarative metadata for fork-specific tables.

    Keeping these outside `vacuula_server.db.Base` ensures `check_db_is_up_to_date()`
    and upstream Alembic linear migrations remain completely conflict-free when
    merging `upstream/main`.
    """


class ServerSetting(ForkBase):
    __tablename__ = "fork__server_setting"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class ConsumableReset(ForkBase):
    __tablename__ = "fork__consumable_reset"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # "{serial}:{consumable}"
    robot: Mapped[str] = mapped_column(String, nullable=False, index=True)
    consumable: Mapped[str] = mapped_column(String, nullable=False)
    reset_at: Mapped[str | None] = mapped_column(String, nullable=True)  # None = count all runs
    threshold_hours: Mapped[float] = mapped_column(Float, nullable=False)
    warned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ServerSchedule(ForkBase):
    __tablename__ = "fork__server_schedule"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    robot: Mapped[str] = mapped_column(String, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # "one_off" (e.g. Next Day / specific datetime) or "recurring" (e.g. Gen 3 multi-zone)
    schedule_type: Mapped[str] = mapped_column(String, nullable=False, default="one_off")
    run_at_iso: Mapped[str | None] = mapped_column(String, nullable=True)
    days: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    time_hhmm: Mapped[str] = mapped_column(String, nullable=False, default="09:00")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    last_triggered_key: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ScheduleSkip(ForkBase):
    __tablename__ = "fork__schedule_skip"

    robot: Mapped[str] = mapped_column(String, primary_key=True)
    skip_until_iso: Mapped[str | None] = mapped_column(String, nullable=True)
    native_restore_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class RobotTelemetry(ForkBase):
    __tablename__ = "fork__robot_telemetry"

    serial: Mapped[str] = mapped_column(String, primary_key=True)
    ip_address: Mapped[str | None] = mapped_column(String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    firmware: Mapped[str | None] = mapped_column(String, nullable=True)
    last_seen_at: Mapped[str | None] = mapped_column(String, nullable=True)
    info_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    stats_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    last_state_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


DEFAULT_CONSUMABLES: dict[str, float] = {
    "filter": 120.0,
    "main_brush": 300.0,
    "side_brush": 200.0,
    "sensors": 30.0,
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_fork_tables() -> None:
    """Create fork-specific SQLite tables idempotently and seed defaults."""
    ForkBase.metadata.create_all(engine)
    _seed_notification_settings()


def _default_notification_settings() -> dict[str, Any]:
    env_url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    return {
        "discord_webhook_url": env_url,
        "enabled": bool(env_url),
        "events": {
            "connectivity": True,
            "cleaning": True,
            "errors": True,
            "run_summary": True,
            "consumables": True,
        },
    }


def _seed_notification_settings() -> None:
    try:
        with get_session() as session:
            existing = session.get(ServerSetting, "notifications")
            if existing is None:
                session.add(
                    ServerSetting(
                        key="notifications",
                        value=_default_notification_settings(),
                        updated_at=now_iso(),
                    )
                )
                session.commit()
            else:
                # If DB has empty URL and env var was newly provided, populate it
                val = dict(existing.value or {})
                env_url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
                if not val.get("discord_webhook_url") and env_url:
                    val["discord_webhook_url"] = env_url
                    val["enabled"] = True
                    existing.value = val
                    existing.updated_at = now_iso()
                    session.commit()
    except Exception as e:
        logger.warning("Failed to seed notification settings: %s", e)


def get_notification_settings() -> dict[str, Any]:
    defaults = _default_notification_settings()
    try:
        with get_session() as session:
            row = session.get(ServerSetting, "notifications")
            if not row or not isinstance(row.value, dict):
                return defaults
            merged_events = {**defaults["events"], **(row.value.get("events") or {})}
            return {
                "discord_webhook_url": str(row.value.get("discord_webhook_url", defaults["discord_webhook_url"])).strip(),
                "enabled": bool(row.value.get("enabled", defaults["enabled"])),
                "events": merged_events,
            }
    except Exception:
        return defaults


def save_notification_settings(data: dict[str, Any]) -> dict[str, Any]:
    current = get_notification_settings()
    events = {**current["events"], **(data.get("events") or {})}
    updated = {
        "discord_webhook_url": str(data.get("discord_webhook_url", current["discord_webhook_url"])).strip(),
        "enabled": bool(data.get("enabled", current["enabled"])),
        "events": {k: bool(v) for k, v in events.items()},
    }
    with get_session() as session:
        row = session.get(ServerSetting, "notifications")
        if row is None:
            session.add(ServerSetting(key="notifications", value=updated, updated_at=now_iso()))
        else:
            row.value = updated
            row.updated_at = now_iso()
        session.commit()
    return updated


def upsert_robot_telemetry(
    serial: str,
    *,
    ip_address: str | None = None,
    model: str | None = None,
    firmware: str | None = None,
    info_json: dict[str, Any] | None = None,
    stats_json: dict[str, Any] | None = None,
    last_state_json: dict[str, Any] | None = None,
    touch_seen: bool = True,
) -> None:
    if not serial or serial == "<unknown>":
        return
    try:
        with get_session() as session:
            row = session.get(RobotTelemetry, serial)
            if row is None:
                row = RobotTelemetry(
                    serial=serial,
                    ip_address=ip_address,
                    model=model,
                    firmware=firmware,
                    last_seen_at=now_iso() if touch_seen else None,
                    info_json=info_json or {},
                    stats_json=stats_json or {},
                    last_state_json=last_state_json or {},
                )
                session.add(row)
            else:
                if ip_address:
                    row.ip_address = ip_address
                if model:
                    row.model = model
                if firmware:
                    row.firmware = firmware
                if touch_seen:
                    row.last_seen_at = now_iso()
                if info_json is not None:
                    row.info_json = {**(row.info_json or {}), **info_json}
                if stats_json is not None:
                    row.stats_json = {**(row.stats_json or {}), **stats_json}
                if last_state_json is not None:
                    row.last_state_json = last_state_json
            session.commit()
    except Exception as e:
        logger.debug("upsert_robot_telemetry failed for %s: %s", serial, e)


def get_robot_telemetry(serial: str) -> dict[str, Any] | None:
    try:
        with get_session() as session:
            row = session.get(RobotTelemetry, serial)
            if row is None:
                return None
            return {
                "serial": row.serial,
                "ip_address": row.ip_address,
                "model": row.model,
                "firmware": row.firmware,
                "last_seen_at": row.last_seen_at,
                "info": row.info_json or {},
                "stats": row.stats_json or {},
                "last_state": row.last_state_json or {},
            }
    except Exception:
        return None


def get_all_robot_telemetry() -> dict[str, dict[str, Any]]:
    try:
        with get_session() as session:
            rows = session.execute(select(RobotTelemetry)).scalars().all()
            return {
                r.serial: {
                    "ip_address": r.ip_address,
                    "model": r.model,
                    "firmware": r.firmware,
                    "last_seen_at": r.last_seen_at,
                    "info": r.info_json or {},
                    "stats": r.stats_json or {},
                    "last_state": r.last_state_json or {},
                }
                for r in rows
            }
    except Exception:
        return {}


def _parse_iso_ts(val: str | None) -> float | None:
    if not val:
        return None
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def _collect_robot_run_durations(serial: str) -> list[tuple[float, float]]:
    """Return list of (end_timestamp, duration_hours) for a robot's historical runs."""
    results: list[tuple[float, float]] = []
    is_gen3 = "-" in serial
    with get_session() as session:
        if is_gen3:
            runs = session.execute(select(Gen3__Run).where(Gen3__Run.robot == serial)).scalars().all()
            for r in runs:
                run_obj = r.run or {}
                t0 = _parse_iso_ts(run_obj.get("start_at"))
                t1 = _parse_iso_ts(run_obj.get("end_at"))
                if t0 is not None and t1 is not None and t1 >= t0:
                    results.append((t1, (t1 - t0) / 3600.0))
        else:
            runs = session.execute(select(Gen4__Run).where(Gen4__Run.robot == serial)).scalars().all()
            for r in runs:
                timing = r.timing or {}
                if isinstance(timing, dict):
                    t0 = _parse_iso_ts(timing.get("start"))
                    t1 = _parse_iso_ts(timing.get("end"))
                    if t0 is not None and t1 is not None and t1 >= t0:
                        results.append((t1, (t1 - t0) / 3600.0))
    return results


def get_consumables_status(serial: str) -> list[dict[str, Any]]:
    run_durations = _collect_robot_run_durations(serial)
    with get_session() as session:
        rows = session.execute(
            select(ConsumableReset).where(ConsumableReset.robot == serial)
        ).scalars().all()
        by_type = {r.consumable: r for r in rows}

        items: list[dict[str, Any]] = []
        dirty = False
        for key, default_hours in DEFAULT_CONSUMABLES.items():
            row = by_type.get(key)
            if row is None:
                row = ConsumableReset(
                    id=f"{serial}:{key}",
                    robot=serial,
                    consumable=key,
                    reset_at=None,
                    threshold_hours=default_hours,
                    warned=False,
                )
                session.add(row)
                dirty = True

            reset_ts = _parse_iso_ts(row.reset_at)
            used_hours = sum(
                dur for end_ts, dur in run_durations if (reset_ts is None or end_ts > reset_ts)
            )
            threshold = max(1.0, float(row.threshold_hours or default_hours))
            remaining_hours = max(0.0, threshold - used_hours)
            percent_remaining = max(0.0, min(100.0, (remaining_hours / threshold) * 100.0))

            items.append({
                "consumable": key,
                "used_hours": round(used_hours, 2),
                "threshold_hours": round(threshold, 1),
                "remaining_hours": round(remaining_hours, 2),
                "percent_remaining": round(percent_remaining, 1),
                "reset_at": row.reset_at,
                "needs_attention": remaining_hours <= 0.0 or percent_remaining <= 10.0,
            })

        if dirty:
            session.commit()
    return items


def reset_consumable(serial: str, consumable: str, threshold_hours: float | None = None) -> list[dict[str, Any]]:
    if consumable not in DEFAULT_CONSUMABLES:
        raise ValueError(f"Unknown consumable: {consumable}")
    with get_session() as session:
        row_id = f"{serial}:{consumable}"
        row = session.get(ConsumableReset, row_id)
        default_h = DEFAULT_CONSUMABLES[consumable]
        if row is None:
            row = ConsumableReset(
                id=row_id,
                robot=serial,
                consumable=consumable,
                reset_at=now_iso(),
                threshold_hours=float(threshold_hours) if threshold_hours else default_h,
                warned=False,
            )
            session.add(row)
        else:
            row.reset_at = now_iso()
            row.warned = False
            if threshold_hours is not None and threshold_hours > 0:
                row.threshold_hours = float(threshold_hours)
        session.commit()
    return get_consumables_status(serial)


def update_consumable_threshold(serial: str, consumable: str, threshold_hours: float) -> list[dict[str, Any]]:
    if consumable not in DEFAULT_CONSUMABLES:
        raise ValueError(f"Unknown consumable: {consumable}")
    with get_session() as session:
        row_id = f"{serial}:{consumable}"
        row = session.get(ConsumableReset, row_id)
        if row is None:
            row = ConsumableReset(
                id=row_id,
                robot=serial,
                consumable=consumable,
                reset_at=None,
                threshold_hours=max(1.0, float(threshold_hours)),
                warned=False,
            )
            session.add(row)
        else:
            row.threshold_hours = max(1.0, float(threshold_hours))
            row.warned = False
        session.commit()
    return get_consumables_status(serial)


def pop_newly_worn_consumables(serial: str) -> list[dict[str, Any]]:
    """Return consumables that just crossed <= 10% remaining and haven't notified yet."""
    statuses = get_consumables_status(serial)
    newly_worn: list[dict[str, Any]] = []
    with get_session() as session:
        dirty = False
        for st in statuses:
            if st["needs_attention"]:
                row = session.get(ConsumableReset, f"{serial}:{st['consumable']}")
                if row and not row.warned:
                    row.warned = True
                    dirty = True
                    newly_worn.append(st)
        if dirty:
            session.commit()
    return newly_worn


def list_server_schedules(serial: str | None = None) -> list[dict[str, Any]]:
    with get_session() as session:
        stmt = select(ServerSchedule)
        if serial:
            stmt = stmt.where(ServerSchedule.robot == serial)
        rows = session.execute(stmt).scalars().all()
        return [
            {
                "id": r.id,
                "robot": r.robot,
                "name": r.name,
                "enabled": r.enabled,
                "schedule_type": r.schedule_type,
                "run_at_iso": r.run_at_iso,
                "days": r.days or [],
                "time_hhmm": r.time_hhmm,
                "payload": r.payload or {},
                "last_triggered_key": r.last_triggered_key,
                "created_at": r.created_at,
            }
            for r in rows
        ]


def upsert_server_schedule(serial: str, data: dict[str, Any]) -> dict[str, Any]:
    sched_id = str(data.get("id") or uuid.uuid4())
    with get_session() as session:
        row = session.get(ServerSchedule, sched_id)
        if row is None:
            row = ServerSchedule(
                id=sched_id,
                robot=serial,
                name=str(data.get("name") or ""),
                enabled=bool(data.get("enabled", True)),
                schedule_type=str(data.get("schedule_type") or "one_off"),
                run_at_iso=data.get("run_at_iso"),
                days=list(data.get("days") or []),
                time_hhmm=str(data.get("time_hhmm") or "09:00"),
                payload=dict(data.get("payload") or {}),
                last_triggered_key=None,
                created_at=now_iso(),
            )
            session.add(row)
        else:
            row.name = str(data.get("name", row.name))
            row.enabled = bool(data.get("enabled", row.enabled))
            row.schedule_type = str(data.get("schedule_type", row.schedule_type))
            row.run_at_iso = data.get("run_at_iso", row.run_at_iso)
            if "days" in data:
                row.days = list(data.get("days") or [])
            if "time_hhmm" in data:
                row.time_hhmm = str(data.get("time_hhmm") or "09:00")
            if "payload" in data:
                row.payload = dict(data.get("payload") or {})
        session.commit()
        return {
            "id": row.id,
            "robot": row.robot,
            "name": row.name,
            "enabled": row.enabled,
            "schedule_type": row.schedule_type,
            "run_at_iso": row.run_at_iso,
            "days": row.days or [],
            "time_hhmm": row.time_hhmm,
            "payload": row.payload or {},
            "last_triggered_key": row.last_triggered_key,
            "created_at": row.created_at,
        }


def mark_server_schedule_triggered(sched_id: str, trigger_key: str, disable: bool = False) -> None:
    with get_session() as session:
        row = session.get(ServerSchedule, sched_id)
        if row:
            row.last_triggered_key = trigger_key
            if disable:
                row.enabled = False
            session.commit()


def delete_server_schedule(serial: str, sched_id: str) -> bool:
    with get_session() as session:
        row = session.get(ServerSchedule, sched_id)
        if row is None or row.robot != serial:
            return False
        session.delete(row)
        session.commit()
        return True


def get_schedule_skip(serial: str) -> dict[str, Any] | None:
    with get_session() as session:
        row = session.get(ScheduleSkip, serial)
        if row is None or not row.skip_until_iso:
            return None
        return {
            "robot": row.robot,
            "skip_until_iso": row.skip_until_iso,
            "native_restore_json": row.native_restore_json,
            "created_at": row.created_at,
        }


def list_all_schedule_skips() -> list[dict[str, Any]]:
    with get_session() as session:
        rows = session.execute(select(ScheduleSkip)).scalars().all()
        return [
            {
                "robot": r.robot,
                "skip_until_iso": r.skip_until_iso,
                "native_restore_json": r.native_restore_json,
                "created_at": r.created_at,
            }
            for r in rows
            if r.skip_until_iso
        ]


def set_schedule_skip(
    serial: str,
    skip_until_iso: str,
    native_restore_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with get_session() as session:
        row = session.get(ScheduleSkip, serial)
        if row is None:
            row = ScheduleSkip(
                robot=serial,
                skip_until_iso=skip_until_iso,
                native_restore_json=native_restore_json,
                created_at=now_iso(),
            )
            session.add(row)
        else:
            row.skip_until_iso = skip_until_iso
            if native_restore_json is not None:
                row.native_restore_json = native_restore_json
            row.created_at = now_iso()
        session.commit()
        return {
            "robot": row.robot,
            "skip_until_iso": row.skip_until_iso,
            "created_at": row.created_at,
        }


def clear_schedule_skip(serial: str) -> dict[str, Any] | None:
    with get_session() as session:
        row = session.get(ScheduleSkip, serial)
        if row is None:
            return None
        restore = row.native_restore_json
        session.delete(row)
        session.commit()
        return restore


def purge_fork_robot_data(serial: str) -> None:
    with get_session() as session:
        session.execute(delete(ConsumableReset).where(ConsumableReset.robot == serial))
        session.execute(delete(ServerSchedule).where(ServerSchedule.robot == serial))
        session.execute(delete(ScheduleSkip).where(ScheduleSkip.robot == serial))
        session.execute(delete(RobotTelemetry).where(RobotTelemetry.serial == serial))
        session.commit()
