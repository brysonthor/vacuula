import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaTrash } from 'react-icons/fa'
import { IoMdCheckmarkCircle, IoMdCloseCircleOutline, IoMdTime } from 'react-icons/io'
import { SlEnergy } from 'react-icons/sl'
import Button from '../../components/button/button'
import { useIsDesktop } from '../../components/hooks/useMediaQuery'
import Map from '../../components/map/map'
import type { Zone } from '../../components/map/types'
import Modal from '../../components/modal/Modal'
import ResponsivePanel from '../../components/responsivePanel/ResponsivePanel'
import { useApp } from '../../context/useApp'
import { useRobot } from '../../context/useRobot'
import { Http } from '../../http'
import i18n from '../../i18n'
import { usePersistentMaps } from '../../loaders/resources'
import { Neato, RobotType } from '../../types'
import { useUnits } from '../../units'
import styles from './runs.module.scss'

type AnyRunItem = Neato.Gen4.Cleaning | Neato.Gen3.CleaningRun
type StatusFilter = 'all' | 'complete' | 'incomplete'
type TriggerFilter = 'all' | 'app' | 'schedule' | 'button'

function isRunComplete(item: AnyRunItem): boolean {
    return 'cleaning_complete' in item ? !!item.cleaning_complete : item.run?.status === 'complete'
}

function getRunStartIso(item: AnyRunItem): string {
    return 'timing' in item ? item.timing.start : item.run.start_at
}

function getRunEndIso(item: AnyRunItem): string {
    return 'timing' in item ? item.timing.end : item.run.end_at
}

function getRunTrigger(item: AnyRunItem): string {
    return ('timing' in item ? item.started_by : item.run.launched_from) || 'unknown'
}

function getRunArea(item: AnyRunItem): number {
    if ('timing' in item) {
        return (item.runs ?? []).reduce((sum, r) => sum + (r.stats?.area ?? 0), 0)
    }
    return item.run?.cleaned_area ?? 0
}

function getRunBattery(item: AnyRunItem): number {
    if ('battery_consumed' in item) return Math.max(0, item.battery_consumed ?? 0)
    return Math.max(0, (item.run?.run_charge_at_start ?? 0) - (item.run?.run_charge_at_end ?? 0))
}

function formatDuration(startDate: string, endDate: string) {
    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime()
    const totalSeconds = Math.max(0, Math.floor((end - start) / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) {
        return i18n.t('runs.durationLong', { hours, minutes, seconds })
    }
    return i18n.t('runs.durationShort', { minutes, seconds })
}

function TrendSparkChart({
    values,
    label,
    unitLabel,
    color = 'var(--accent)',
}: {
    values: number[]
    label: string
    unitLabel: string
    color?: string
}) {
    if (values.length < 2) return null
    const w = 280
    const h = 58
    const pad = 6
    const max = Math.max(...values, 1)
    const min = Math.min(...values, 0)
    const range = Math.max(1e-3, max - min)

    const pts = values.map((v, idx) => {
        const x = pad + (idx / (values.length - 1)) * (w - pad * 2)
        const y = h - pad - ((v - min) / range) * (h - pad * 2)
        return `${x.toFixed(1)},${y.toFixed(1)}`
    })

    const latest = values[values.length - 1]

    return (
        <div className={styles.sparkCard}>
            <div className={styles.sparkHeader}>
                <span className={styles.sparkTitle}>{label}</span>
                <span className={styles.sparkLatest}>
                    {Math.round(latest * 10) / 10} {unitLabel}
                </span>
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} className={styles.sparkSvg} preserveAspectRatio="none">
                <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={pts.join(' ')}
                />
            </svg>
        </div>
    )
}

export default function Runs() {
    const { t } = useTranslation()
    const { units, formatArea } = useUnits()
    const { setCleanings, cleanings } = useApp()
    const { robot } = useRobot()
    const isDesktop = useIsDesktop()
    const { data: persistentMaps } = usePersistentMaps()

    const [selectedCleaning, setSelectedCleaning] = useState<AnyRunItem | undefined>()
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all')
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [zoneNameLookup, setZoneNameLookup] = useState<Record<string, string>>({})

    const loadCleanings = () => {
        Http.getCleanings(robot.serial).then(res => {
            const sorted: AnyRunItem[] = [...(res.data ?? [])].sort(
                (a, b) => new Date(getRunStartIso(b)).getTime() - new Date(getRunStartIso(a)).getTime()
            )
            setCleanings(sorted as any)
        })
    }

    useEffect(() => {
        setSelectedCleaning(undefined)
        loadCleanings()
    }, [robot.serial])

    // Build track_uuid -> Zone Name map for Gen 4 run segments
    useEffect(() => {
        if (robot.type !== RobotType.NeatoGen4 || !persistentMaps?.length) {
            setZoneNameLookup({})
            return
        }
        let cancelled = false
        Promise.all(
            persistentMaps.map(m =>
                Http.getBoundaries(robot.serial, m.id)
                    .then(r => (r.data ?? []) as Zone[])
                    .catch(() => [] as Zone[])
            )
        ).then(groups => {
            if (cancelled) return
            const map: Record<string, string> = {}
            for (const list of groups) {
                for (const b of list) {
                    if (b?.id && b?.name) {
                        map[b.id] = b.name
                    }
                }
            }
            setZoneNameLookup(map)
        })
        return () => {
            cancelled = true
        }
    }, [robot.serial, robot.type, persistentMaps])

    const filteredCleanings = useMemo(() => {
        const list = (cleanings ?? []) as AnyRunItem[]
        return list.filter(item => {
            if (statusFilter === 'complete' && !isRunComplete(item)) return false
            if (statusFilter === 'incomplete' && isRunComplete(item)) return false
            if (triggerFilter !== 'all') {
                const trig = getRunTrigger(item).toLowerCase()
                if (triggerFilter === 'schedule' && !trig.includes('sched')) return false
                if (triggerFilter === 'app' && !trig.includes('app')) return false
                if (triggerFilter === 'button' && !trig.includes('robot') && !trig.includes('button')) return false
            }
            return true
        })
    }, [cleanings, statusFilter, triggerFilter])

    // Auto-select first run on desktop
    useEffect(() => {
        if (isDesktop && filteredCleanings.length > 0) {
            if (!selectedCleaning || !filteredCleanings.some(c => c.id === selectedCleaning.id)) {
                setSelectedCleaning(filteredCleanings[0])
            }
        }
    }, [isDesktop, filteredCleanings, selectedCleaning])

    const lifetimeStats = useMemo(() => {
        const all = (cleanings ?? []) as AnyRunItem[]
        const totalRuns = all.length
        const completed = all.filter(isRunComplete).length
        const totalArea = all.reduce((s, item) => s + getRunArea(item), 0)
        // Chronological last 14 runs for sparklines
        const recentChrono = [...all].slice(0, 14).reverse()
        const areaSeries = recentChrono.map(item =>
            units === 'imperial' ? getRunArea(item) * 10.7639 : getRunArea(item)
        )
        const batterySeries = recentChrono.map(getRunBattery)
        return {
            totalRuns,
            completionPct: totalRuns > 0 ? Math.round((completed / totalRuns) * 100) : 0,
            totalArea,
            areaSeries,
            batterySeries,
        }
    }, [cleanings, units])

    const handleDeleteRun = async () => {
        if (!selectedCleaning) return
        const deletedId = selectedCleaning.id
        await Http.deleteRun(robot.serial, deletedId)
        setDeleteModalOpen(false)
        setMobileDrawerOpen(false)
        const remaining = ((cleanings ?? []) as AnyRunItem[]).filter(c => c.id !== deletedId)
        setCleanings(remaining as any)
        setSelectedCleaning(isDesktop ? remaining[0] : undefined)
    }

    const renderDetailContent = (cleaning: AnyRunItem) => {
        const completed = isRunComplete(cleaning)
        return (
            <div className={styles.detailBody}>
                <div className={styles.detailTopBar}>
                    <div>
                        <h2 className={styles.detailTitle}>
                            {new Date(getRunStartIso(cleaning)).toLocaleString()}
                        </h2>
                        <span className={styles.detailSub}>
                            {t('runs.startedBy', 'Triggered by')}: <strong>{getRunTrigger(cleaning)}</strong>
                        </span>
                    </div>
                    <button
                        type="button"
                        className={styles.deleteRunBtn}
                        onClick={() => setDeleteModalOpen(true)}
                        title={t('runs.deleteRun', 'Delete Run')}
                    >
                        <FaTrash size={13} />
                        <span>{t('common.delete', 'Delete')}</span>
                    </button>
                </div>

                <div className={styles.basicInfos}>
                    <div className={styles.basicInfo}>
                        <span>{t('runs.status', 'Status')}</span>
                        <span className={completed ? styles.okIcon : styles.errIcon}>
                            {completed ? <IoMdCheckmarkCircle size={20} /> : <IoMdCloseCircleOutline size={20} />}
                            {completed ? t('runs.complete', 'Complete') : t('runs.incomplete', 'Incomplete')}
                        </span>
                    </div>
                    <div className={styles.basicInfo}>
                        <span>{t('runs.duration')}</span>
                        <span className={styles.monoVal}>
                            {formatDuration(getRunStartIso(cleaning), getRunEndIso(cleaning))}
                        </span>
                    </div>
                    <div className={styles.basicInfo}>
                        <span>{t('runs.area')}</span>
                        <span className={styles.monoVal}>{formatArea(getRunArea(cleaning))}</span>
                    </div>
                    <div className={styles.basicInfo}>
                        <span>{t('runs.battery')}</span>
                        <span className={styles.monoVal}>{getRunBattery(cleaning)}%</span>
                    </div>
                </div>

                <div className={styles.runMapBox}>
                    <Map key={cleaning.id} mapId={cleaning.id} runId={cleaning.id} />
                </div>

                {/* Path Coverage Color Legend */}
                <div className={styles.legendBar}>
                    <span className={styles.legendItem}>
                        <span className={styles.swatchFloor} />
                        {t('runs.legendFloor', 'Floor Space')}
                    </span>
                    <span className={styles.legendItem}>
                        <span className={styles.swatchWall} />
                        {t('runs.legendWalls', 'Walls & Obstacles')}
                    </span>
                    <span className={styles.legendItem}>
                        <span className={styles.swatchPass1} />
                        <span className={styles.swatchPass2} />
                        {t('runs.legendCoverage', 'Cleaned Path Segments')}
                    </span>
                </div>

                {/* Per-segment / Diagnostic Cards */}
                <div className={styles.runs}>
                    {'runs' in cleaning &&
                        cleaning.runs.map((run, i) => {
                            const zoneLabel = run.track_uuid
                                ? zoneNameLookup[run.track_uuid] ?? `${t('map.zone', 'Zone')} (${run.track_uuid.slice(0, 8)})`
                                : t('home.allRoomsDefault', 'Full Floorplan')
                            return (
                                <div key={i} className={styles.run}>
                                    <div className={styles.info}>
                                        <div className={styles.segHeader}>
                                            <span className={styles.segTitle}>{zoneLabel}</span>
                                            <span className={styles.segStatePill}>{run.state}</span>
                                        </div>
                                        <span className={styles.type}>
                                            {formatDuration(run.timing.start, run.timing.end)} · {formatArea(run.stats.area)} ·{' '}
                                            {run.settings.mode} / {run.settings.navigation_mode}
                                        </span>
                                        <span className={styles.type}>
                                            {t('runs.timing', {
                                                error: run.timing.error,
                                                pause: run.timing.pause,
                                                charging: run.timing.charging,
                                            })}
                                            {' · '}
                                            {t('runs.pickedUp', { count: run.stats.pickup_count })}
                                        </span>
                                    </div>
                                </div>
                            )
                        })}

                    {'run' in cleaning && (
                        <div className={styles.run}>
                            <div className={styles.info}>
                                <div className={styles.segHeader}>
                                    <span className={styles.segTitle}>{cleaning.run.status}</span>
                                    <div className={styles.diagBadges}>
                                        {cleaning.run.is_docked && (
                                            <span className={styles.badgeOk}>{t('runs.docked', 'Docked')}</span>
                                        )}
                                        {cleaning.run.modifier === 2 && (
                                            <span className={styles.badgeInfo}>2× Pass</span>
                                        )}
                                        {cleaning.run.localization_lost && (
                                            <span className={styles.badgeWarn}>
                                                {t('runs.localizationLost', 'Localization Lost')}
                                            </span>
                                        )}
                                        {cleaning.run.teleported && (
                                            <span className={styles.badgeWarn}>
                                                {t('runs.teleported', 'Relocated')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {cleaning.run.error && (
                                    <span className={styles.errText}>
                                        {t(`robotErrorCode.${RobotType.NeatoGen3}.${cleaning.run.error}` as any, cleaning.run.error)}
                                    </span>
                                )}

                                <span className={styles.type}>
                                    {formatDuration(cleaning.run.start_at, cleaning.run.end_at)} ·{' '}
                                    {formatArea(cleaning.run.cleaned_area)} ·{' '}
                                    {Neato.Gen3.CleaningMode[cleaning.run.mode]}{' '}
                                    {Neato.Gen3.CleaningNavigationMode[cleaning.run.navigation_mode]}
                                </span>
                                <span className={styles.type}>
                                    {t('runs.timing', {
                                        error: cleaning.run.time_in_error,
                                        pause: cleaning.run.time_in_pause,
                                        charging: cleaning.run.time_in_suspended_cleaning,
                                    })}
                                    {' · '}
                                    {t('runs.pickedUp', { count: cleaning.run.picked_up_count })}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    if (!cleanings) return null

    return (
        <div className={styles.pageLayout}>
            {/* ── Master List Pane ── */}
            <section className={styles.masterPane}>
                <div className={styles.summaryStrip}>
                    <div className={styles.summaryCell}>
                        <span className={styles.summaryVal}>{lifetimeStats.totalRuns}</span>
                        <span className={styles.summaryLbl}>{t('runs.totalRuns', 'Runs')}</span>
                    </div>
                    <div className={styles.summaryCell}>
                        <span className={styles.summaryVal}>{lifetimeStats.completionPct}%</span>
                        <span className={styles.summaryLbl}>{t('runs.successRate', 'Completed')}</span>
                    </div>
                    <div className={styles.summaryCell}>
                        <span className={styles.summaryVal}>{formatArea(lifetimeStats.totalArea)}</span>
                        <span className={styles.summaryLbl}>{t('runs.lifetimeArea', 'Total Area')}</span>
                    </div>
                </div>

                {!isDesktop && lifetimeStats.areaSeries.length >= 2 && (
                    <div className={styles.mobileTrendsWrap}>
                        <TrendSparkChart
                            values={lifetimeStats.areaSeries}
                            label={t('runs.areaTrend', 'Area Trend')}
                            unitLabel={units === 'imperial' ? 'ft²' : 'm²'}
                        />
                    </div>
                )}

                <div className={styles.filterRow}>
                    <select
                        className={styles.filterSelect}
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                        aria-label="Filter by status"
                    >
                        <option value="all">{t('runs.filterAllStatus', 'All Statuses')}</option>
                        <option value="complete">{t('runs.complete', 'Completed')}</option>
                        <option value="incomplete">{t('runs.incomplete', 'Incomplete / Error')}</option>
                    </select>
                    <select
                        className={styles.filterSelect}
                        value={triggerFilter}
                        onChange={e => setTriggerFilter(e.target.value as TriggerFilter)}
                        aria-label="Filter by trigger"
                    >
                        <option value="all">{t('runs.filterAllTriggers', 'All Triggers')}</option>
                        <option value="app">{t('runs.triggerApp', 'App')}</option>
                        <option value="schedule">{t('runs.triggerSchedule', 'Schedule')}</option>
                        <option value="button">{t('runs.triggerButton', 'Robot Button')}</option>
                    </select>
                </div>

                <div className={styles.featureList}>
                    {filteredCleanings.map(item => {
                        const isSelected = selectedCleaning?.id === item.id
                        const ok = isRunComplete(item)
                        return (
                            <button
                                key={item.id}
                                type="button"
                                className={`${styles.item} ${isSelected && isDesktop ? styles.itemActive : ''}`}
                                onClick={() => {
                                    setSelectedCleaning(item)
                                    if (!isDesktop) setMobileDrawerOpen(true)
                                }}
                            >
                                <div className={styles.info}>
                                    <span className={styles.itemTitle}>
                                        {t('runs.entryTitle', {
                                            startedBy: getRunTrigger(item),
                                            date: new Date(getRunStartIso(item)).toLocaleString(),
                                        })}
                                    </span>
                                    <span className={styles.type}>
                                        <IoMdTime /> {formatDuration(getRunStartIso(item), getRunEndIso(item))} ·{' '}
                                        {formatArea(getRunArea(item))} · <SlEnergy /> {getRunBattery(item)}%
                                    </span>
                                </div>
                                <span className={ok ? styles.okIcon : styles.errIcon}>
                                    {ok ? <IoMdCheckmarkCircle size={20} /> : <IoMdCloseCircleOutline size={20} />}
                                </span>
                            </button>
                        )
                    })}

                    {filteredCleanings.length === 0 && (
                        <div className={styles.emptyRuns}>{t('runs.noRuns')}</div>
                    )}
                </div>
            </section>

            {/* ── Desktop Detail Pane ── */}
            {isDesktop && (
                <section className={styles.detailPane}>
                    {lifetimeStats.areaSeries.length >= 2 && (
                        <div className={styles.trendsRow}>
                            <TrendSparkChart
                                values={lifetimeStats.areaSeries}
                                label={t('runs.areaTrend', 'Recent Area Cleaned')}
                                unitLabel={units === 'imperial' ? 'ft²' : 'm²'}
                                color="var(--accent)"
                            />
                            <TrendSparkChart
                                values={lifetimeStats.batterySeries}
                                label={t('runs.batteryTrend', 'Battery Used per Run')}
                                unitLabel="%"
                                color="var(--info)"
                            />
                        </div>
                    )}

                    {selectedCleaning ? (
                        renderDetailContent(selectedCleaning)
                    ) : (
                        <div className={styles.emptyDetailState}>
                            {t('runs.selectRunPrompt', 'Select a cleaning run on the left to inspect its coverage map and diagnostics.')}
                        </div>
                    )}
                </section>
            )}

            {/* ── Mobile Detail Drawer ── */}
            {!isDesktop && (
                <ResponsivePanel
                    open={mobileDrawerOpen && !!selectedCleaning}
                    onOpenChange={setMobileDrawerOpen}
                    handle={false}
                    openHeightPercent={82}
                    title={
                        selectedCleaning
                            ? new Date(getRunStartIso(selectedCleaning)).toLocaleString()
                            : ''
                    }
                >
                    {selectedCleaning && renderDetailContent(selectedCleaning)}
                </ResponsivePanel>
            )}

            <Modal
                open={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title={t('runs.deleteRunTitle', 'Delete Cleaning Run?')}
                footer={
                    <>
                        <Button text={t('common.cancel')} style="secondary" onClick={() => setDeleteModalOpen(false)} />
                        <Button text={t('common.delete')} style="fail" onClick={handleDeleteRun} />
                    </>
                }
            >
                <p>
                    {t(
                        'runs.deleteRunConfirm',
                        'This removes the run record and coverage overlay from Vacuula history. Any saved floorplans promoted from this run will be kept.'
                    )}
                </p>
            </Modal>
        </div>
    )
}
