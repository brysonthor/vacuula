import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { FaPlus, FaRegClock, FaTrash } from 'react-icons/fa'
import { IoArrowDown, IoArrowUp, IoClose } from 'react-icons/io5'
import { MdSkipNext } from 'react-icons/md'
import Button from '../../components/button/button'
import Input from '../../components/input/input'
import type { NoGoLine, UseState, Zone } from '../../components/map/types'
import ResponsivePanel from '../../components/responsivePanel/ResponsivePanel'
import { isGen4D10 } from '../../components/topbar/robotInfo'
import { useRobot } from '../../context/useRobot'
import { Http } from '../../http'
import { GEN4_COMMANDS } from '../../http/gen4'
import { dayKey } from '../../i18n/days'
import { Neato, type ScheduleSkipState, type ServerScheduleItem } from '../../types'
import { formatUtcOffset } from '../../utils/clockTime'
import { useGetPromotedFloorplan } from '../../utils/floormaps'
import WeeklyCalendarGrid, { type CalendarSlot } from './WeeklyCalendarGrid'
import styles from './schedule.module.scss'

function getDayText(days: Neato.Gen4.Days[], t: TFunction) {
    const set = new Set(days)
    if (set.size === 7) return t('schedule.everyday')
    if (set.size === 2 && set.has(Neato.Gen4.Days.SATURDAY) && set.has(Neato.Gen4.Days.SUNDAY)) {
        return t('schedule.weekends')
    }
    if (set.size === 5 && !set.has(Neato.Gen4.Days.SATURDAY) && !set.has(Neato.Gen4.Days.SUNDAY)) {
        return t('schedule.weekdays')
    }
    return days.map(d => t(`days.${dayKey(d)}`)).join(', ')
}

function getTomorrowMorningLocalIso(): string {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`
}

interface RoomRunOverride {
    mode?: Neato.Gen4.CleaningMode
    navigation_mode?: Neato.Gen4.CleaningNavigationMode
}

export default function ScheduleGen4() {
    const { t } = useTranslation()
    const { robot, serverInfo } = useRobot()
    const [searchParams, setSearchParams] = useSearchParams()
    const offset = serverInfo.utc_offset_minutes ?? 0

    const [schedule, setSchedule] = useState<Neato.Gen4.ScheduledCommands>({ enabled: true, events: [] })
    const [serverSchedules, setServerSchedules] = useState<ServerScheduleItem[]>([])
    const [skipState, setSkipState] = useState<ScheduleSkipState>({ active: false })
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [editorKind, setEditorKind] = useState<'firmware' | 'one_off'>('firmware')
    const [editingServerId, setEditingServerId] = useState<string | undefined>()
    const [oneOffName, setOneOffName] = useState('')
    const [runAtLocal, setRunAtLocal] = useState(getTomorrowMorningLocalIso())

    const [defaultNavMode, setDefaultNavMode] = useState<Neato.Gen4.CleaningNavigationMode>(
        Neato.Gen4.CleaningNavigationMode.NORMAL
    )
    const [defaultCleanMode, setDefaultCleanMode] = useState<Neato.Gen4.CleaningMode>(
        Neato.Gen4.CleaningMode.ECO
    )
    const [forceFloorplan, setForceFloorplan] = useState<boolean>(false)

    const getPromotedFloorplan = useGetPromotedFloorplan()
    const [promotedFloorplan, setPromotedFloorplan] = useState<Neato.Gen4.Floorplan>()
    useEffect(() => {
        getPromotedFloorplan().then(setPromotedFloorplan)
    }, [getPromotedFloorplan])

    const [boundaries, setBoundaries] = useState<(NoGoLine | Zone)[]>([])
    useEffect(() => {
        if (!promotedFloorplan) return
        Http.getBoundaries(robot.serial, promotedFloorplan.id).then(res => setBoundaries(res.data ?? []))
    }, [promotedFloorplan, robot.serial])

    const cleaningZones = useMemo(
        () => boundaries.filter((b): b is Zone => b.type === 'polygon' && b.function === 'cleaning'),
        [boundaries]
    )

    const [selectedZones, setSelectedZones] = useState<string[]>([])
    const [roomOverrides, setRoomOverrides] = useState<Record<string, RoomRunOverride>>({})
    const [nogoEnabled, setNogoEnabled] = useState<boolean>(true)
    const [usePromotedFloorplan, setUsePromotedFloorplan] = useState<boolean>(true)

    const [scheduleForm, setScheduleForm] = useState<Omit<Neato.Gen4.CommandEvent, 'command'>>({
        enabled: true,
        days: [],
        time: '09:00',
    })

    const loadAll = () => {
        if (robot.online) {
            GEN4_COMMANDS.getSchedule(robot.serial)
                .then(res => {
                    if (res.data?.body) setSchedule(res.data.body)
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

    // Support ?zone=<id> shortcut from Map Studio
    useEffect(() => {
        const preZone = searchParams.get('zone')
        if (!preZone) return
        setEditorKind('firmware')
        setScheduleForm({
            enabled: true,
            days: [Neato.Gen4.Days.MONDAY, Neato.Gen4.Days.WEDNESDAY, Neato.Gen4.Days.FRIDAY],
            time: '09:00',
        })
        setUsePromotedFloorplan(true)
        setNogoEnabled(true)
        setSelectedZones([preZone])
        setRoomOverrides({})
        setDrawerOpen(true)
        setSearchParams({}, { replace: true })
    }, [searchParams, setSearchParams])

    const setFormFromEvent = (event: Neato.Gen4.CommandEvent) => {
        setEditorKind('firmware')
        setEditingServerId(undefined)
        setScheduleForm({
            id: event.id,
            enabled: event.enabled,
            days: event.days,
            time: event.time,
        })
        const firstRun = event.command.runs[0]
        setDefaultNavMode(firstRun?.settings?.navigation_mode ?? Neato.Gen4.CleaningNavigationMode.NORMAL)
        setDefaultCleanMode(firstRun?.settings?.mode ?? Neato.Gen4.CleaningMode.ECO)
        setForceFloorplan(!!event.command.force_floorplan)

        if (!firstRun || firstRun.map === null) {
            setUsePromotedFloorplan(false)
            setSelectedZones([])
            setRoomOverrides({})
        } else {
            setUsePromotedFloorplan(true)
            setNogoEnabled(firstRun.map.nogo_enabled)
            const tracks = event.command.runs
                .map(r => r.map?.track_id)
                .filter((id): id is string => id != null)
            setSelectedZones(tracks)
            const ovs: Record<string, RoomRunOverride> = {}
            for (const r of event.command.runs) {
                if (r.map?.track_id) {
                    ovs[r.map.track_id] = {
                        mode: r.settings.mode,
                        navigation_mode: r.settings.navigation_mode,
                    }
                }
            }
            setRoomOverrides(ovs)
        }
        setDrawerOpen(true)
    }

    const openCleanForm = () => {
        setEditorKind('firmware')
        setEditingServerId(undefined)
        setScheduleForm({
            enabled: true,
            days: [Neato.Gen4.Days.MONDAY],
            time: '09:00',
        })
        setDefaultNavMode(Neato.Gen4.CleaningNavigationMode.NORMAL)
        setDefaultCleanMode(Neato.Gen4.CleaningMode.ECO)
        setForceFloorplan(false)
        setUsePromotedFloorplan(!!promotedFloorplan)
        setNogoEnabled(true)
        setSelectedZones([])
        setRoomOverrides({})
        setDrawerOpen(true)
    }

    const openOneOffForm = () => {
        setEditorKind('one_off')
        setEditingServerId(undefined)
        setOneOffName('')
        setRunAtLocal(getTomorrowMorningLocalIso())
        setUsePromotedFloorplan(!!promotedFloorplan)
        setNogoEnabled(true)
        setSelectedZones([])
        setRoomOverrides({})
        setDrawerOpen(true)
    }

    const moveZone = (idx: number, delta: -1 | 1) => {
        setSelectedZones(prev => {
            const target = idx + delta
            if (target < 0 || target >= prev.length) return prev
            const copy = [...prev]
            const [item] = copy.splice(idx, 1)
            copy.splice(target, 0, item)
            return copy
        })
    }

    const buildRuns = (): Neato.Gen4.SchduleRun[] => {
        const defaultSettings = {
            mode: defaultCleanMode,
            navigation_mode: defaultNavMode,
        }
        const mapId = usePromotedFloorplan ? promotedFloorplan?.id : undefined
        if (!mapId) return [{ map: null, settings: defaultSettings }]
        if (selectedZones.length === 0) {
            return [{ map: { rank_id: mapId, track_id: null, nogo_enabled: nogoEnabled }, settings: defaultSettings }]
        }
        return selectedZones.map(zId => ({
            map: { rank_id: mapId, track_id: zId, nogo_enabled: nogoEnabled },
            settings: {
                mode: roomOverrides[zId]?.mode ?? defaultCleanMode,
                navigation_mode: roomOverrides[zId]?.navigation_mode ?? defaultNavMode,
            },
        }))
    }

    const handleSave = async () => {
        const runs = buildRuns()

        if (editorKind === 'one_off') {
            await Http.saveServerSchedule(robot.serial, {
                id: editingServerId,
                name: oneOffName || t('schedule.oneOffClean', 'One-Off Clean'),
                enabled: true,
                schedule_type: 'one_off',
                run_at_iso: new Date(runAtLocal).toISOString(),
                time_hhmm: runAtLocal.split('T')[1]?.slice(0, 5) || '09:00',
                payload: {
                    map_id: usePromotedFloorplan ? promotedFloorplan?.id : undefined,
                    nogo_enabled: nogoEnabled,
                    mode: defaultCleanMode,
                    navigationMode: defaultNavMode,
                    runs,
                },
            })
            setDrawerOpen(false)
            loadAll()
            return
        }

        if (!robot.online || scheduleForm.days.length === 0 || !scheduleForm.time) return
        await GEN4_COMMANDS.updateOrAddSchduledEvent(robot.serial, {
            ...scheduleForm,
            command: {
                ability: 'cleaning.start',
                auto_localization: false,
                force_floorplan: forceFloorplan,
                runs,
            },
        })
        setDrawerOpen(false)
        loadAll()
    }

    const removeEvent = (id: string) => {
        if (!robot.online) return
        setDrawerOpen(false)
        GEN4_COMMANDS.deleteScheduledEvent(robot.serial, id).finally(loadAll)
    }

    const updateForm = <T extends object>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({ ...prev, ...patch }))
    }

    const calendarSlots = useMemo<CalendarSlot[]>(() => {
        const slots: CalendarSlot[] = []
        ;(schedule.events ?? []).forEach((ev, idx) => {
            const roomLabels = ev.command.runs
                .map(r => (r.map?.track_id ? cleaningZones.find(z => z.id === r.map?.track_id)?.name : null))
                .filter(Boolean)
            const summaryLabel =
                roomLabels.length > 0
                    ? roomLabels.join(' → ')
                    : ev.command.runs[0]?.map
                        ? t('home.map', 'Floorplan')
                        : t('home.house', 'House')
            ;(ev.days ?? []).forEach(d => {
                slots.push({
                    id: `g4-${ev.id ?? idx}-${d}`,
                    dayCode: d as CalendarSlot['dayCode'],
                    time: ev.time,
                    label: summaryLabel,
                    subLabel: ev.command.runs[0]?.settings.mode ?? 'eco',
                    source: 'firmware',
                    enabled: schedule.enabled && ev.enabled,
                    onClick: () => setFormFromEvent(ev),
                })
            })
        })
        return slots
    }, [schedule, cleaningZones, t])

    return (
        <div className={styles.pageWrap}>
            <div className={styles.mainCol}>
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
                            onChange={val => {
                                if (!robot.online) return
                                GEN4_COMMANDS.setScheduleEnabled(robot.serial, val).then(loadAll)
                            }}
                        />
                    </div>
                </div>

                <WeeklyCalendarGrid slots={calendarSlots} />

                <div className={styles.createActionBar}>
                    <button
                        type="button"
                        className={styles.primaryCreateBtn}
                        disabled={!robot.online}
                        onClick={openCleanForm}
                    >
                        <FaPlus size={13} />
                        <span>{t('schedule.newSchedule', 'Add Recurring Schedule')}</span>
                    </button>
                    <button type="button" className={styles.secondaryCreateBtn} onClick={openOneOffForm}>
                        <FaRegClock size={14} />
                        <span>{t('schedule.addOneOff', 'One-Off / Clean Tomorrow')}</span>
                    </button>
                </div>

                <section className={styles.sectionBlock}>
                    <h2 className={styles.sectionHeading}>
                        {t('schedule.onboardSchedules', 'Onboard Robot Schedules')}
                    </h2>
                    <div className={styles.featureList}>
                        {(schedule.events ?? []).map((item, i) => {
                            const zoneNames = item.command.runs
                                .map(r => (r.map?.track_id ? cleaningZones.find(z => z.id === r.map?.track_id)?.name : null))
                                .filter(Boolean)
                            return (
                                <div key={item.id ?? i} className={styles.item} onClick={() => setFormFromEvent(item)}>
                                    <div className={styles.info}>
                                        <span className={styles.timeReadout}>{item.time}</span>
                                        <span className={styles.type}>
                                            {t('schedule.gen4Summary', {
                                                when: getDayText(item.days, t),
                                                mode: item.command.runs[0]?.settings.mode ?? 'eco',
                                                navigation: item.command.runs[0]?.settings.navigation_mode ?? 'normal',
                                            })}
                                            {zoneNames.length > 0 ? ` · ${zoneNames.join(' → ')}` : ''}
                                        </span>
                                    </div>
                                    <div onClick={e => e.stopPropagation()}>
                                        <Input
                                            type="switch"
                                            skipSection={true}
                                            value={item.enabled}
                                            onChange={() => {
                                                if (!robot.online) return
                                                GEN4_COMMANDS.updateOrAddSchduledEvent(robot.serial, {
                                                    ...item,
                                                    enabled: !item.enabled,
                                                }).then(loadAll)
                                            }}
                                        />
                                    </div>
                                </div>
                            )
                        })}
                        {(schedule.events ?? []).length === 0 && (
                            <span className={styles.emptyText}>{t('schedule.noSchedules')}</span>
                        )}
                    </div>
                </section>

                {serverSchedules.length > 0 && (
                    <section className={styles.sectionBlock}>
                        <h2 className={styles.sectionHeading}>
                            {t('schedule.serverRoutines', 'Scheduled One-Off Cleans')}
                        </h2>
                        <div className={styles.featureList}>
                            {serverSchedules.map(item => (
                                <div key={item.id} className={styles.item}>
                                    <div className={styles.info}>
                                        <span className={styles.timeReadout}>
                                            {item.run_at_iso
                                                ? new Date(item.run_at_iso).toLocaleString()
                                                : item.time_hhmm}
                                        </span>
                                        <span className={styles.type}>{item.name}</span>
                                    </div>
                                    <div className={styles.rowActions}>
                                        <Input
                                            type="switch"
                                            skipSection={true}
                                            value={item.enabled}
                                            onChange={enabled =>
                                                Http.saveServerSchedule(robot.serial, { ...item, enabled }).then(loadAll)
                                            }
                                        />
                                        <button
                                            type="button"
                                            className={styles.trashBtn}
                                            onClick={() => Http.deleteServerSchedule(robot.serial, item.id).then(loadAll)}
                                            aria-label="Delete one-off clean"
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

            <ResponsivePanel
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
                closableDesktop={true}
                handle={false}
                openHeightPercent={82}
                title={
                    editorKind === 'one_off'
                        ? t('schedule.addOneOff', 'Schedule One-Off Clean')
                        : t('schedule.addEvent', 'Edit Schedule')
                }
                width="42rem"
            >
                <div className={styles.editorStack}>
                    {editorKind === 'one_off' ? (
                        <>
                            <Input
                                type="text"
                                label={t('common.name', 'Label')}
                                value={oneOffName}
                                onChange={setOneOffName}
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
                                    { value: Neato.Gen4.Days.MONDAY, label: t('days.monday') },
                                    { value: Neato.Gen4.Days.TUESDAY, label: t('days.tuesday') },
                                    { value: Neato.Gen4.Days.WEDNESDAY, label: t('days.wednesday') },
                                    { value: Neato.Gen4.Days.THURSDAY, label: t('days.thursday') },
                                    { value: Neato.Gen4.Days.FRIDAY, label: t('days.friday') },
                                    { value: Neato.Gen4.Days.SATURDAY, label: t('days.saturday') },
                                    { value: Neato.Gen4.Days.SUNDAY, label: t('days.sunday') },
                                ]}
                                value={scheduleForm.days}
                                onChange={days => updateForm(setScheduleForm, { days: days as Neato.Gen4.Days[] })}
                            />
                            <Input
                                type="time"
                                label={t('common.time')}
                                value={scheduleForm.time}
                                onChange={time => updateForm(setScheduleForm, { time })}
                            />
                            <Input
                                type="switch"
                                label={t('settings.forceFloorplan', 'Force Floorplan Match')}
                                value={forceFloorplan}
                                onChange={setForceFloorplan}
                            />
                        </>
                    )}

                    <Input
                        type="select"
                        label={t('common.mode')}
                        options={[
                            { value: Neato.Gen4.CleaningMode.ECO, label: t('modes.eco') },
                            { value: Neato.Gen4.CleaningMode.TURBO, label: t('modes.turbo') },
                            ...(isGen4D10(robot)
                                ? [
                                      { value: Neato.Gen4.CleaningMode.MAX, label: t('modes.max') },
                                      { value: Neato.Gen4.CleaningMode.AUTO, label: t('modes.auto') },
                                  ]
                                : []),
                        ]}
                        value={defaultCleanMode}
                        onChange={mode => setDefaultCleanMode(mode as Neato.Gen4.CleaningMode)}
                    />

                    <Input
                        type="select"
                        label={t('schedule.navigation')}
                        options={[
                            { value: Neato.Gen4.CleaningNavigationMode.NORMAL, label: t('modes.normal') },
                            { value: Neato.Gen4.CleaningNavigationMode.GENTLE, label: t('modes.gentle') },
                        ]}
                        value={defaultNavMode}
                        onChange={nav => setDefaultNavMode(nav as Neato.Gen4.CleaningNavigationMode)}
                    />

                    {promotedFloorplan && (
                        <>
                            <Input
                                type="switch"
                                label={t('schedule.usePromoted')}
                                value={usePromotedFloorplan}
                                onChange={setUsePromotedFloorplan}
                            />

                            {usePromotedFloorplan && (
                                <>
                                    <Input
                                        type="switch"
                                        label={t('schedule.useNogoLayer')}
                                        value={nogoEnabled}
                                        onChange={setNogoEnabled}
                                    />

                                    {cleaningZones.length > 0 && (
                                        <div className={styles.fieldBlock}>
                                            <span className={styles.smallLabel}>
                                                {t('schedule.selectZones')}
                                            </span>
                                            <div className={styles.zoneChipWrap}>
                                                {cleaningZones.map(z => {
                                                    const idx = selectedZones.indexOf(z.id)
                                                    const active = idx !== -1
                                                    return (
                                                        <button
                                                            key={z.id}
                                                            type="button"
                                                            className={`${styles.zoneChip} ${active ? styles.zoneChipActive : ''}`}
                                                            onClick={() =>
                                                                setSelectedZones(prev =>
                                                                    prev.includes(z.id)
                                                                        ? prev.filter(id => id !== z.id)
                                                                        : [...prev, z.id]
                                                                )
                                                            }
                                                        >
                                                            {active && <span className={styles.seqNum}>{idx + 1}</span>}
                                                            <span>{z.name}</span>
                                                        </button>
                                                    )
                                                })}
                                            </div>

                                            {selectedZones.length > 0 && (
                                                <div className={styles.roomOrderList}>
                                                    {selectedZones.map((zId, idx) => {
                                                        const z = cleaningZones.find(c => c.id === zId)
                                                        if (!z) return null
                                                        const ov = roomOverrides[zId] ?? {}
                                                        return (
                                                            <div key={zId} className={styles.roomOrderRow}>
                                                                <div className={styles.roomOrderTop}>
                                                                    <span className={styles.seqNum}>{idx + 1}</span>
                                                                    <span className={styles.roomName}>{z.name}</span>
                                                                    <div className={styles.orderBtns}>
                                                                        <button
                                                                            type="button"
                                                                            disabled={idx === 0}
                                                                            onClick={() => moveZone(idx, -1)}
                                                                        >
                                                                            <IoArrowUp size={13} />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            disabled={idx === selectedZones.length - 1}
                                                                            onClick={() => moveZone(idx, 1)}
                                                                        >
                                                                            <IoArrowDown size={13} />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                setSelectedZones(prev =>
                                                                                    prev.filter(id => id !== zId)
                                                                                )
                                                                            }
                                                                        >
                                                                            <IoClose size={14} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div className={styles.overridePair}>
                                                                    <select
                                                                        value={ov.mode ?? ''}
                                                                        onChange={e =>
                                                                            setRoomOverrides(cur => ({
                                                                                ...cur,
                                                                                [zId]: {
                                                                                    ...cur[zId],
                                                                                    mode: (e.target.value || undefined) as any,
                                                                                },
                                                                            }))
                                                                        }
                                                                    >
                                                                        <option value="">Default suction</option>
                                                                        <option value={Neato.Gen4.CleaningMode.ECO}>Eco</option>
                                                                        <option value={Neato.Gen4.CleaningMode.TURBO}>Turbo</option>
                                                                        <option value={Neato.Gen4.CleaningMode.MAX}>Max</option>
                                                                        <option value={Neato.Gen4.CleaningMode.AUTO}>Auto</option>
                                                                    </select>
                                                                    <select
                                                                        value={ov.navigation_mode ?? ''}
                                                                        onChange={e =>
                                                                            setRoomOverrides(cur => ({
                                                                                ...cur,
                                                                                [zId]: {
                                                                                    ...cur[zId],
                                                                                    navigation_mode: (e.target.value || undefined) as any,
                                                                                },
                                                                            }))
                                                                        }
                                                                    >
                                                                        <option value="">Default nav</option>
                                                                        <option value={Neato.Gen4.CleaningNavigationMode.NORMAL}>Normal</option>
                                                                        <option value={Neato.Gen4.CleaningNavigationMode.GENTLE}>Gentle</option>
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    <Button text={t('common.save')} style="success" onClick={handleSave} />
                    {editorKind === 'firmware' && scheduleForm.id && (
                        <Button text={t('common.delete')} style="fail" onClick={() => removeEvent(scheduleForm.id!)} />
                    )}
                </div>
            </ResponsivePanel>
        </div>
    )
}
