import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FaPlus, FaRegClock, FaTrash } from 'react-icons/fa'
import { MdSkipNext } from 'react-icons/md'
import Button from '../../components/button/button'
import Input from '../../components/input/input'
import ResponsivePanel from '../../components/responsivePanel/ResponsivePanel'
import { useRobot } from '../../context/useRobot'
import { Http } from '../../http'
import { GEN3_COMMANDS } from '../../http/gen3'
import { dayKey } from '../../i18n/days'
import { fetchAllGen3Boundaries, getCachedZones } from '../../loaders/gen3Boundaries'
import { usePersistentMaps } from '../../loaders/resources'
import { RobotType, type ScheduleSkipState, type ServerScheduleItem } from '../../types'
import { RobotDay } from '../../types/neato/gen3/api'
import { CleaningMode, CleaningModifier, CleaningNavigationMode } from '../../types/neato/gen3/state'
import { formatUtcOffset } from '../../utils/clockTime'
import Scheudle_gen4 from './scheudle_gen4'
import WeeklyCalendarGrid, { type CalendarSlot } from './WeeklyCalendarGrid'
import type { GetSchedule, ScheduleEvent } from './types'
import styles from './schedule.module.scss'

const ROBOT_DAY_TO_CODE: Record<number, CalendarSlot['dayCode']> = {
    [RobotDay.SUNDAY]: 'sun',
    [RobotDay.MONDAY]: 'mon',
    [RobotDay.TUESDAY]: 'tue',
    [RobotDay.WEDNESDAY]: 'wed',
    [RobotDay.THURSDAY]: 'thu',
    [RobotDay.FRIDAY]: 'fri',
    [RobotDay.SATURDAY]: 'sat',
}

function getTomorrowMorningLocalIso(): string {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`
}

export default function SchedulePage() {
    const { robot } = useRobot()
    if (robot.type === RobotType.NeatoGen4) {
        return <Scheudle_gen4 />
    }
    return <ScheduleGen3 />
}

function ScheduleGen3() {
    const { t } = useTranslation()
    const { robot, serverInfo } = useRobot()
    const [searchParams, setSearchParams] = useSearchParams()
    const { data: persistentMaps } = usePersistentMaps()

    const [schedule, setSchedule] = useState<GetSchedule>({ enabled: true, events: [] })
    const [serverSchedules, setServerSchedules] = useState<ServerScheduleItem[]>([])
    const [skipState, setSkipState] = useState<ScheduleSkipState>({ active: false })
    const [panelOpen, setPanelOpen] = useState(false)
    const [editorKind, setEditorKind] = useState<'recurring' | 'one_off'>('recurring')
    const [editingNativeIdx, setEditingNativeIdx] = useState<number | null>(null)
    const [editingServerId, setEditingServerId] = useState<string | undefined>()

    // Form state
    const [selectedDays, setSelectedDays] = useState<number[]>([RobotDay.MONDAY])
    const [startTime, setStartTime] = useState('09:00')
    const [runAtLocal, setRunAtLocal] = useState(getTomorrowMorningLocalIso())
    const [mode, setMode] = useState<CleaningMode>(CleaningMode.NORMAL)
    const [navMode, setNavMode] = useState<CleaningNavigationMode>(CleaningNavigationMode.NORMAL)
    const [selectedZones, setSelectedZones] = useState<string[]>([])
    const [routineName, setRoutineName] = useState('')
    const [boundariesTick, setBoundariesTick] = useState(0)

    useEffect(() => {
        if (!persistentMaps) return
        fetchAllGen3Boundaries(robot.serial, persistentMaps, robot.online).then(() =>
            setBoundariesTick(n => n + 1)
        )
    }, [robot.serial, robot.online, persistentMaps])

    const zoneOptions = useMemo(() => {
        void boundariesTick
        return (persistentMaps ?? [])
            .filter(m => 'enabled' in m && m.enabled)
            .flatMap(m =>
                getCachedZones(robot.serial, m.id).map(z => ({
                    value: z.id,
                    label: `${m.name} — ${z.name}`,
                    rawName: z.name,
                }))
            )
    }, [persistentMaps, robot.serial, boundariesTick])

    const loadAll = () => {
        if (robot.online) {
            GEN3_COMMANDS.getSchedule(robot.serial)
                .then(res => {
                    if (res.data?.data) setSchedule(res.data.data)
                })
                .catch(() => {})
        }
        Http.getServerSchedules(robot.serial)
            .then(res => setServerSchedules(res.data ?? []))
            .catch(() => {})
        Http.getScheduleSkip(robot.serial)
            .then(res => setSkipState(res.data ?? { active: false }))
            .catch(() => {})
    }

    useEffect(() => {
        loadAll()
    }, [robot.serial, robot.online])

    // Pre-open if navigated from Map Studio ?zone=...
    useEffect(() => {
        const preZone = searchParams.get('zone')
        if (!preZone) return
        setEditingNativeIdx(null)
        setEditingServerId(undefined)
        setEditorKind('recurring')
        setSelectedDays([RobotDay.MONDAY, RobotDay.WEDNESDAY, RobotDay.FRIDAY])
        setStartTime('09:00')
        setSelectedZones([preZone])
        setPanelOpen(true)
        setSearchParams({}, { replace: true })
    }, [searchParams, setSearchParams])

    const openNewRecurring = () => {
        setEditorKind('recurring')
        setEditingNativeIdx(null)
        setEditingServerId(undefined)
        setRoutineName('')
        setSelectedDays([RobotDay.MONDAY])
        setStartTime('09:00')
        setMode(CleaningMode.NORMAL)
        setNavMode(CleaningNavigationMode.NORMAL)
        setSelectedZones([])
        setPanelOpen(true)
    }

    const openNewOneOff = () => {
        setEditorKind('one_off')
        setEditingNativeIdx(null)
        setEditingServerId(undefined)
        setRoutineName('')
        setRunAtLocal(getTomorrowMorningLocalIso())
        setMode(CleaningMode.NORMAL)
        setNavMode(CleaningNavigationMode.NORMAL)
        setSelectedZones([])
        setPanelOpen(true)
    }

    const openEditNative = (ev: ScheduleEvent, idx: number) => {
        setEditorKind('recurring')
        setEditingNativeIdx(idx)
        setEditingServerId(undefined)
        setSelectedDays([ev.day])
        setStartTime(ev.startTime)
        setMode(ev.mode)
        const zId = ev.boundaryId || ev.boundary?.id
        setSelectedZones(zId ? [zId] : [])
        setPanelOpen(true)
    }

    const openEditServer = (item: ServerScheduleItem) => {
        setEditingNativeIdx(null)
        setEditingServerId(item.id)
        setEditorKind(item.schedule_type)
        setRoutineName(item.name || '')
        setStartTime(item.time_hhmm || '09:00')
        if (item.run_at_iso) {
            setRunAtLocal(item.run_at_iso.slice(0, 16))
        }
        const codeToRobotDay: Record<string, number> = {
            sun: 0,
            mon: 1,
            tue: 2,
            wed: 3,
            thu: 4,
            fri: 5,
            sat: 6,
        }
        setSelectedDays((item.days ?? []).map(d => codeToRobotDay[d] ?? 1))
        setMode((item.payload?.mode as CleaningMode) ?? CleaningMode.NORMAL)
        setNavMode((item.payload?.navigationMode as CleaningNavigationMode) ?? CleaningNavigationMode.NORMAL)
        setSelectedZones((item.payload?.zones ?? []).map(z => z.id))
        setPanelOpen(true)
    }

    const handleSave = async () => {
        if (editorKind === 'one_off') {
            const iso = new Date(runAtLocal).toISOString()
            await Http.saveServerSchedule(robot.serial, {
                id: editingServerId,
                name: routineName || t('schedule.oneOffClean', 'One-Off Clean'),
                enabled: true,
                schedule_type: 'one_off',
                run_at_iso: iso,
                time_hhmm: runAtLocal.split('T')[1]?.slice(0, 5) || '09:00',
                payload: {
                    category: selectedZones.length > 0 ? 4 : 2,
                    mode,
                    modifier: CleaningModifier.NORMAL,
                    navigationMode: navMode,
                    zones: selectedZones.map(id => ({
                        id,
                        name: zoneOptions.find(o => o.value === id)?.rawName ?? id,
                        mode,
                        modifier: CleaningModifier.NORMAL,
                        navigationMode: navMode,
                    })),
                },
            })
            setPanelOpen(false)
            loadAll()
            return
        }

        // Recurring: if >= 2 zones OR editing an existing server schedule -> save as Server Multi-Zone Schedule
        const needsServerOrchestration =
            selectedZones.length >= 2 ||
            !!editingServerId

        if (needsServerOrchestration) {
            const dayCodes = selectedDays.map(d => ROBOT_DAY_TO_CODE[d] ?? 'mon')
            await Http.saveServerSchedule(robot.serial, {
                id: editingServerId,
                name:
                    routineName ||
                    (selectedZones.length > 0
                        ? `${selectedZones.length} Rooms Routine`
                        : t('schedule.serverRoutine', 'Vacuula Routine')),
                enabled: true,
                schedule_type: 'recurring',
                days: dayCodes,
                time_hhmm: startTime,
                payload: {
                    category: selectedZones.length > 0 ? 4 : 2,
                    mode,
                    modifier: CleaningModifier.NORMAL,
                    navigationMode: navMode,
                    zones: selectedZones.map(id => ({
                        id,
                        name: zoneOptions.find(o => o.value === id)?.rawName ?? id,
                        mode,
                        modifier: CleaningModifier.NORMAL,
                        navigationMode: navMode,
                    })),
                },
            })
            setPanelOpen(false)
            loadAll()
            return
        }

        // Otherwise sync directly to onboard Gen 3 firmware!
        if (!robot.online || !startTime || selectedDays.length === 0) return
        const baseEvents = [...(schedule.events ?? [])]
        if (editingNativeIdx !== null) {
            baseEvents.splice(editingNativeIdx, 1)
        }
        const newNativeEvents: ScheduleEvent[] = selectedDays.map(d => ({
            day: d as RobotDay,
            startTime,
            mode,
            ...(selectedZones[0] ? { boundaryId: selectedZones[0] } : {}),
        }))
        await GEN3_COMMANDS.setSchedule(robot.serial, [...newNativeEvents, ...baseEvents])
        setPanelOpen(false)
        loadAll()
    }

    const removeNativeEvent = (index: number) => {
        if (!robot.online) return
        const next = [...(schedule.events ?? [])]
        next.splice(index, 1)
        GEN3_COMMANDS.setSchedule(robot.serial, next).finally(loadAll)
    }

    const calendarSlots = useMemo<CalendarSlot[]>(() => {
        const slots: CalendarSlot[] = []
        ;(schedule.events ?? []).forEach((ev, idx) => {
            const dayCode = ROBOT_DAY_TO_CODE[ev.day]
            if (!dayCode) return
            slots.push({
                id: `fw-${idx}`,
                dayCode,
                time: ev.startTime,
                label: ev.boundary?.name || t('home.house', 'House'),
                subLabel: ev.mode === CleaningMode.ECO ? 'Eco' : 'Turbo',
                source: 'firmware',
                enabled: schedule.enabled,
                onClick: () => openEditNative(ev, idx),
            })
        })
        serverSchedules
            .filter(s => s.schedule_type === 'recurring')
            .forEach(s => {
                ;(s.days ?? []).forEach(d => {
                    slots.push({
                        id: `srv-${s.id}-${d}`,
                        dayCode: d as CalendarSlot['dayCode'],
                        time: s.time_hhmm,
                        label: s.name || 'Server Queue',
                        subLabel: 'Vacuula Server',
                        source: 'server',
                        enabled: s.enabled,
                        onClick: () => openEditServer(s),
                    })
                })
            })
        return slots
    }, [schedule, serverSchedules, t])

    const offset = serverInfo.utc_offset_minutes ?? 0

    return (
        <div className={styles.pageWrap}>
            <div className={styles.mainCol}>
                {/* Header + Global Enable + Skip Next Clean */}
                <div className={styles.topHeaderCard}>
                    <div className={styles.info}>
                        <h1 className={styles.pageTitle}>{t('schedule.schedule')}</h1>
                        <span className={styles.tzSub}>
                            {serverInfo.timezone} ({formatUtcOffset(offset)})
                        </span>
                    </div>
                    <div className={styles.headerControls}>
                        {skipState.skip_until_iso ? (
                            <button
                                type="button"
                                className={styles.skipActivePill}
                                onClick={() => Http.cancelScheduleSkip(robot.serial).then(loadAll)}
                            >
                                <span>
                                    {t('schedule.skippingUntil', 'Skipping until')}{' '}
                                    {new Date(skipState.skip_until_iso).toLocaleString([], {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}{' '}
                                    — {t('schedule.resume', 'Resume')}
                                </span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                className={styles.skipBtn}
                                onClick={() => Http.activateScheduleSkip(robot.serial).then(loadAll)}
                            >
                                <MdSkipNext size={18} />
                                <span>{t('schedule.skipNext', 'Skip Next Clean (24h)')}</span>
                            </button>
                        )}

                        <Input
                            type="switch"
                            skipSection={true}
                            value={schedule.enabled}
                            onChange={() => {
                                if (!robot.online) return
                                const cmd = schedule.enabled
                                    ? GEN3_COMMANDS.disableSchedule
                                    : GEN3_COMMANDS.enableSchedule
                                cmd(robot.serial).then(loadAll)
                            }}
                        />
                    </div>
                </div>

                {/* 7-Day Weekly Calendar Grid */}
                <WeeklyCalendarGrid slots={calendarSlots} />

                {/* Action Buttons */}
                <div className={styles.createActionBar}>
                    <button type="button" className={styles.primaryCreateBtn} onClick={openNewRecurring}>
                        <FaPlus size={13} />
                        <span>{t('schedule.newSchedule', 'Add Recurring Schedule')}</span>
                    </button>
                    <button type="button" className={styles.secondaryCreateBtn} onClick={openNewOneOff}>
                        <FaRegClock size={14} />
                        <span>{t('schedule.addOneOff', 'One-Off / Clean Tomorrow')}</span>
                    </button>
                </div>

                {/* Onboard Firmware Schedules */}
                <section className={styles.sectionBlock}>
                    <h2 className={styles.sectionHeading}>
                        {t('schedule.onboardSchedules', 'Onboard Robot Schedules')}
                    </h2>
                    <div className={styles.featureList}>
                        {(schedule.events ?? []).map((item, i) => (
                            <div key={i} className={styles.item} onClick={() => openEditNative(item, i)}>
                                <div className={styles.info}>
                                    <span className={styles.timeReadout}>{item.startTime}</span>
                                    <span className={styles.type}>
                                        {t('schedule.gen3Summary', {
                                            day: t(`days.${dayKey(item.day)}`),
                                            mode: CleaningMode[item.mode],
                                        })}
                                        {item.boundary &&
                                            ` · ${t('schedule.gen3SummaryZone', { zone: item.boundary.name })}`}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className={styles.trashBtn}
                                    onClick={e => {
                                        e.stopPropagation()
                                        removeNativeEvent(i)
                                    }}
                                    aria-label="Delete schedule"
                                >
                                    <FaTrash size={14} />
                                </button>
                            </div>
                        ))}
                        {(schedule.events ?? []).length === 0 && (
                            <span className={styles.emptyText}>{t('schedule.noSchedules')}</span>
                        )}
                    </div>
                </section>

                {/* Vacuula Server Schedules (One-Off + Multi-Zone Routines) */}
                {serverSchedules.length > 0 && (
                    <section className={styles.sectionBlock}>
                        <h2 className={styles.sectionHeading}>
                            {t('schedule.serverRoutines', 'Vacuula Server Routines & One-Off Cleans')}
                        </h2>
                        <div className={styles.featureList}>
                            {serverSchedules.map(item => (
                                <div key={item.id} className={styles.item} onClick={() => openEditServer(item)}>
                                    <div className={styles.info}>
                                        <span className={styles.timeReadout}>
                                            {item.schedule_type === 'one_off' && item.run_at_iso
                                                ? new Date(item.run_at_iso).toLocaleString()
                                                : `${item.time_hhmm} (${(item.days ?? []).join(', ').toUpperCase()})`}
                                        </span>
                                        <span className={styles.type}>
                                            {item.name}
                                            {item.payload?.zones?.length
                                                ? ` · ${item.payload.zones.map(z => z.name || z.id).join(' → ')}`
                                                : ''}
                                        </span>
                                    </div>
                                    <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
                                        <Input
                                            type="switch"
                                            skipSection={true}
                                            value={item.enabled}
                                            onChange={enabled => {
                                                Http.saveServerSchedule(robot.serial, { ...item, enabled }).then(loadAll)
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className={styles.trashBtn}
                                            onClick={() => Http.deleteServerSchedule(robot.serial, item.id).then(loadAll)}
                                            aria-label="Delete server schedule"
                                        >
                                            <FaTrash size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>

            {/* Editor Side Panel / Mobile Drawer */}
            <ResponsivePanel
                open={panelOpen}
                onOpenChange={setPanelOpen}
                closableDesktop={true}
                handle={false}
                openHeightPercent={80}
                title={
                    editorKind === 'one_off'
                        ? t('schedule.addOneOff', 'Schedule One-Off Clean')
                        : t('schedule.addEvent', 'Edit Schedule')
                }
                width="40rem"
            >
                <div className={styles.editorStack}>
                    {editorKind === 'one_off' ? (
                        <>
                            <Input
                                type="text"
                                label={t('common.name', 'Label')}
                                value={routineName}
                                onChange={setRoutineName}
                            />
                            <div className={styles.fieldBlock}>
                                <label className={styles.smallLabel}>
                                    {t('schedule.runDateTime', 'Run Date & Time')}
                                </label>
                                <input
                                    type="datetime-local"
                                    className={styles.nativeDateTimeInput}
                                    value={runAtLocal}
                                    onChange={e => setRunAtLocal(e.target.value)}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <Input
                                type="multi-select"
                                label={t('common.day')}
                                options={[
                                    { value: RobotDay.MONDAY, label: t('days.monday') },
                                    { value: RobotDay.TUESDAY, label: t('days.tuesday') },
                                    { value: RobotDay.WEDNESDAY, label: t('days.wednesday') },
                                    { value: RobotDay.THURSDAY, label: t('days.thursday') },
                                    { value: RobotDay.FRIDAY, label: t('days.friday') },
                                    { value: RobotDay.SATURDAY, label: t('days.saturday') },
                                    { value: RobotDay.SUNDAY, label: t('days.sunday') },
                                ]}
                                value={selectedDays}
                                onChange={days => setSelectedDays(days as number[])}
                            />
                            <Input
                                type="time"
                                label={`${t('common.time')} (${serverInfo.timezone})`}
                                value={startTime}
                                onChange={setStartTime}
                            />
                        </>
                    )}

                    <Input
                        type="select"
                        label={t('common.mode')}
                        options={[
                            { value: CleaningMode.ECO, label: t('modes.eco') },
                            { value: CleaningMode.NORMAL, label: t('modes.turbo', 'Turbo') },
                        ]}
                        value={mode}
                        onChange={val => setMode(Number(val) as CleaningMode)}
                    />

                    {zoneOptions.length > 0 && (
                        <Input
                            type="multi-select"
                            label={t('schedule.selectZones')}
                            extraInfo={t(
                                'schedule.gen3MultiZoneInfo',
                                '1 room syncs directly to the robot; 2+ rooms run sequentially via the Vacuula Server Queue.'
                            )}
                            options={zoneOptions.map(o => ({ value: o.value, label: o.label }))}
                            value={selectedZones}
                            onChange={vals => setSelectedZones(vals as string[])}
                        />
                    )}

                    <Button text={t('common.save')} style="success" onClick={handleSave} />
                </div>
            </ResponsivePanel>
        </div>
    )
}
