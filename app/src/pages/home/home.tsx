import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import TimeAgo from 'react-timeago'
import {
    MdAutoAwesome,
    MdCleaningServices,
    MdError,
    MdMotionPhotosAuto,
    MdOutlineCropFree,
    MdOutlineHealthAndSafety,
    MdRepeat,
    MdWarning,
} from 'react-icons/md'
import { IoMdPause, IoMdPlay, IoMdRefresh } from 'react-icons/io'
import { IoArrowDown, IoArrowUp, IoClose, IoGameControllerOutline, IoMapOutline } from 'react-icons/io5'
import { TbAdjustments, TbBolt, TbHome, TbLeaf } from 'react-icons/tb'
import { FaBell, FaFan, FaStop } from 'react-icons/fa'
import { FaGaugeHigh, FaHouse } from 'react-icons/fa6'
import { BiTargetLock } from 'react-icons/bi'
import { HiMap } from 'react-icons/hi2'
import { CleaningCategory, CleaningMode, CleaningModifier, CleaningNavigationMode } from '../../types/neato/gen3/state'
import { useIsDesktop } from '../../components/hooks/useMediaQuery'
import Input from '../../components/input/input'
import ResponsivePanel from '../../components/responsivePanel/ResponsivePanel'
import { hasRobotError, isCharging, isDocked, isGen4D10 } from '../../components/topbar/robotInfo'
import { useApp } from '../../context/useApp'
import { useRobot } from '../../context/useRobot'
import { Http } from '../../http'
import { GEN3_COMMANDS } from '../../http/gen3'
import { GEN4_COMMANDS } from '../../http/gen4'
import { useTimeAgoFormatter } from '../../i18n/timeago'
import { fetchGen3MapBoundaries } from '../../loaders/gen3Boundaries'
import { usePersistentMaps } from '../../loaders/resources'
import { useMascot } from '../../mascot'
import { Neato, RobotType } from '../../types'
import { useUnits } from '../../units'
import { useGetPromotedFloorplan } from '../../utils/floormaps'
import { getGen3CleaningMode, getGen3NavigationMode, getGen4CleaningMode, getGen4NavigationMode } from '../../utils/modes'
import { BasicState, getRobotStateKey, resolveRobotState } from '../../utils/state'
import type { NoGoLine, Zone } from '../../components/map/types'
import { extractBasePose } from '../../components/map/utils'
import InteractiveFloorplan from './InteractiveFloorplan'
import RingProgress from './RingProgress'
import HeaderLoadingSpinner from '../../components/loading/HeaderLoadingSpinner'
import styles from './home.module.scss'

interface AlertCardProps {
    type?: ('error' | 'warning') | Neato.Gen4.ErrorSeverity
    icon: React.ReactNode
    title: string
    sub?: string
    action?: string
    onClick?: () => void
    robotType: RobotType
}

function AlertCard({ type = 'error', icon, title, sub, action, onClick, robotType }: AlertCardProps) {
    const { t } = useTranslation()
    return (
        <div className={`${styles.alertCard} ${styles[type]}`}>
            <div className={styles.alertIconWrap}>{icon}</div>
            <div className={styles.alertText}>
                <div className={styles.alertTitle}>{title}</div>
                {sub && <div className={styles.alertSub}>{t(`robotErrorCode.${robotType}.${sub}` as any, sub)}</div>}
            </div>
            {action && <button type="button" className={styles.alertAction} onClick={onClick}>{action}</button>}
        </div>
    )
}

function Gen4AlertCards({ errors }: { errors: Neato.Gen4.Error[] }) {
    const { t } = useTranslation()
    return (
        <>
            {errors.map((error, i) => (
                <AlertCard
                    key={i}
                    type={error.severity}
                    icon={<MdError size={17} />}
                    title={t(('home.error.' + error.severity) as any, error.severity)}
                    sub={error.code}
                    robotType={RobotType.NeatoGen4}
                />
            ))}
        </>
    )
}

const BELL_MS = 5 * 2500

interface OrderedZoneOverride {
    mode?: Neato.Gen4.CleaningMode
    navigationMode?: Neato.Gen4.CleaningNavigationMode
}

export default function Home() {
    const { lastHeartbeat, getGen3State, zoneQueues, refreshZoneQueue, cleanings, setCleanings } = useApp()
    const { robot } = useRobot()
    const { t } = useTranslation()
    const timeAgoFormatter = useTimeAgoFormatter()
    const { formatLength, formatArea } = useUnits()
    const { mascot } = useMascot()
    const isDesktop = useIsDesktop()

    const [mobileSetupOpen, setMobileSetupOpen] = useState(false)
    const [bellAnimating, setBellAnimating] = useState(false)

    // Gen 3 modes & capabilities
    const [gen3Mode, setGen3Mode] = useState<CleaningMode>(getGen3CleaningMode())
    const [gen3NavMode, setGen3NavMode] = useState<CleaningNavigationMode>(getGen3NavigationMode())
    const [gen3Modifier, setGen3Modifier] = useState<CleaningModifier>(CleaningModifier.NORMAL)
    const [cleaningCategory, setCleaningCategory] = useState<CleaningCategory>(
        isDocked(robot) ? CleaningCategory.MAP : CleaningCategory.HOUSE
    )

    // Gen 4 modes
    const [gen4Mode, setGen4Mode] = useState<Neato.Gen4.CleaningMode>(getGen4CleaningMode())
    const [gen4NavMode, setGen4NavMode] = useState<Neato.Gen4.CleaningNavigationMode>(getGen4NavigationMode())

    useEffect(() => {
        localStorage.setItem('vacuula.gen3.cleaningMode', gen3Mode.toString())
        localStorage.setItem('vacuula.gen3.navigationMode', gen3NavMode.toString())
        localStorage.setItem('vacuula.gen4.cleaningMode', gen4Mode.toString())
        localStorage.setItem('vacuula.gen4.navigationMode', gen4NavMode.toString())
    }, [gen3Mode, gen3NavMode, gen4Mode, gen4NavMode])

    const [spotHeight, setSpotHeight] = useState(200)
    const [spotWidth, setSpotWidth] = useState(200)
    const [nogoEnabled, setNogoEnabled] = useState<boolean>(true)

    // Floorplans & boundaries
    const getPromotedFloorplan = useGetPromotedFloorplan()
    const [promotedFloorplan, setPromotedFloorplan] = useState<Neato.Gen4.Floorplan>()
    const { data: persistentMaps } = usePersistentMaps()

    const enabledGen3Maps = useMemo(
        () =>
            robot.type === RobotType.NeatoGen3
                ? ((persistentMaps ?? []) as Neato.Gen3.PersistentMap[]).filter(m => m.enabled)
                : [],
        [robot.type, persistentMaps]
    )

    const [selectedGen3MapId, setSelectedGen3MapId] = useState<string>('')
    useEffect(() => {
        if (robot.type === RobotType.NeatoGen3) {
            if (enabledGen3Maps.length > 0 && !enabledGen3Maps.some(m => m.id === selectedGen3MapId)) {
                setSelectedGen3MapId(enabledGen3Maps[0].id)
            }
        }
    }, [robot.type, enabledGen3Maps, selectedGen3MapId])

    useEffect(() => {
        if (robot.type === RobotType.NeatoGen4) {
            getPromotedFloorplan().then(setPromotedFloorplan)
        } else {
            setPromotedFloorplan(undefined)
        }
    }, [robot.type, robot.serial, getPromotedFloorplan])

    const activeMapId = robot.type === RobotType.NeatoGen4 ? promotedFloorplan?.id : selectedGen3MapId
    const [boundaries, setBoundaries] = useState<(NoGoLine | Zone)[]>([])

    useEffect(() => {
        setSelectedZones([])
        setZoneOverrides({})
    }, [robot.serial, activeMapId])

    useEffect(() => {
        if (!activeMapId) {
            setBoundaries([])
            return
        }
        if (robot.type === RobotType.NeatoGen4) {
            Http.getBoundaries(robot.serial, activeMapId)
                .then(res =>
                    setBoundaries(
                        ((res.data ?? []) as (NoGoLine | Zone)[]).filter(
                            b => b.name !== '__vacuula_clean_here__' && !b.id.startsWith('clean-here-')
                        )
                    )
                )
                .catch(() => setBoundaries([]))
        } else {
            fetchGen3MapBoundaries(robot.serial, activeMapId, robot.online).then(list => {
                setBoundaries(
                    list.filter(
                        b => b.name !== '__vacuula_clean_here__' && !b.id.startsWith('clean-here-')
                    )
                )
            })
        }
    }, [robot.serial, robot.type, robot.online, activeMapId])

    // Ordered zone sequence + optional Gen 4 per-room overrides
    const [selectedZones, setSelectedZones] = useState<string[]>([])
    const [zoneOverrides, setZoneOverrides] = useState<Record<string, OrderedZoneOverride>>({})

    const cleaningZones = useMemo(
        () =>
            boundaries.filter(
                (b): b is Zone =>
                    b.type === 'polygon' &&
                    b.enabled !== false &&
                    b.name !== '__vacuula_clean_here__' &&
                    !b.id.startsWith('clean-here-') &&
                    (b.function === 'cleaning' || b.function === undefined)
            ),
        [boundaries]
    )

    const toggleZone = (zoneId: string) => {
        if (cleaningCategory !== CleaningCategory.MAP) {
            setCleaningCategory(CleaningCategory.MAP)
        }
        setSelectedZones(prev =>
            prev.includes(zoneId) ? prev.filter(id => id !== zoneId) : [...prev, zoneId]
        )
    }

    const moveZone = (index: number, delta: -1 | 1) => {
        setSelectedZones(prev => {
            const target = index + delta
            if (target < 0 || target >= prev.length) return prev
            const next = [...prev]
            const [moved] = next.splice(index, 1)
            next.splice(target, 0, moved)
            return next
        })
    }

    // Fetch run history for stats strip
    useEffect(() => {
        Http.getCleanings(robot.serial)
            .then(res => {
                const sorted = [...(res.data ?? [])].sort(
                    (a, b) =>
                        new Date('timing' in b ? b.timing.start : b.run.start_at).getTime() -
                        new Date('timing' in a ? a.timing.start : a.run.start_at).getTime()
                )
                setCleanings(sorted)
            })
            .catch(() => {})
    }, [robot.serial, setCleanings])

    // Poll active Gen 4 cleaning telemetry when busy
    const basicState = resolveRobotState(robot)
    const isBusy = basicState === BasicState.CLEANING || basicState === BasicState.DOCKING
    const currentlyDocked = isDocked(robot)
    const canDock =
        robot.online &&
        !currentlyDocked &&
        (!!robot.availableCommands?.pause ||
            (robot.type === RobotType.NeatoGen3
                ? !!(robot.availableCommands as any)?.goToBase
                : !!(robot.availableCommands as any)?.return_to_base) ||
            !isBusy)

    const [dockingLoading, setDockingLoading] = useState(false)
    const [dockFeedback, setDockFeedback] = useState<{ message: string; error?: boolean } | null>(null)

    const handleDock = async () => {
        if (!robot.online || dockingLoading) return
        setDockingLoading(true)
        setDockFeedback(null)
        try {
            const res = await Http.dockRobot(robot.serial)
            const msg = res.data?.message || t('home.returningToBase', 'Returning to base')
            setDockFeedback({ message: msg, error: !res.data?.ok })
            setTimeout(() => setDockFeedback(null), 5000)
        } catch (err: any) {
            const errorMsg =
                err?.response?.data?.error ||
                err?.message ||
                t('home.dockFailed', 'Failed to return to base')
            setDockFeedback({ message: errorMsg, error: true })
            setTimeout(() => setDockFeedback(null), 6000)
        } finally {
            setDockingLoading(false)
        }
    }

    const [gen4Session, setGen4Session] = useState<Neato.Gen4.CleaningInfo | null>(null)

    useEffect(() => {
        if (!robot.online || robot.type !== RobotType.NeatoGen4 || !isBusy) {
            setGen4Session(null)
            return
        }
        let cancelled = false
        const fetchSession = () => {
            GEN4_COMMANDS.cleaningInfo(robot.serial)
                .then(res => {
                    if (!cancelled && res.data?.body) setGen4Session(res.data.body)
                })
                .catch(() => {})
        }
        fetchSession()
        const timer = setInterval(fetchSession, 8000)
        return () => {
            cancelled = true
            clearInterval(timer)
        }
    }, [robot.serial, robot.type, robot.online, isBusy])

    // Compute stats summary
    const statsSummary = useMemo(() => {
        if (!cleanings || cleanings.length === 0) return null
        const getArea = (item: Neato.Gen4.Cleaning | Neato.Gen3.CleaningRun) =>
            'timing' in item
                ? (item.runs ?? []).reduce((acc, r) => acc + (r.stats?.area ?? 0), 0)
                : item.run?.cleaned_area ?? 0

        const getDurMin = (item: Neato.Gen4.Cleaning | Neato.Gen3.CleaningRun) => {
            const s = new Date('timing' in item ? item.timing.start : item.run.start_at).getTime()
            const e = new Date('timing' in item ? item.timing.end : item.run.end_at).getTime()
            return e > s ? Math.round((e - s) / 60000) : 0
        }

        const lastArea = getArea(cleanings[0])
        const lastDur = getDurMin(cleanings[0])
        const totalArea = cleanings.reduce((sum, item) => sum + getArea(item), 0)
        const avgDur = Math.round(cleanings.reduce((sum, item) => sum + getDurMin(item), 0) / cleanings.length)

        return { lastArea, lastDur, avgDur, totalArea, count: cleanings.length }
    }, [cleanings])

    // Capability checks for Gen 3
    const gen3Services = robot.type === RobotType.NeatoGen3 ? robot.availableServices : undefined
    const houseCleanSvc = gen3Services?.houseCleaning ? String(gen3Services.houseCleaning) : undefined
    const supportsExtraCare = !houseCleanSvc || houseCleanSvc !== 'basic-1'
    const supportsDeep = !houseCleanSvc || houseCleanSvc === 'basic-4'
    const supportsSpot =
        robot.type === RobotType.NeatoGen3 &&
        (!gen3Services || !!gen3Services.spotCleaning)
    const supportsManualDrive =
        robot.type === RobotType.NeatoGen3 &&
        (!gen3Services || !!gen3Services.manualCleaning)

    const activeQueue = zoneQueues[robot.serial]

    const handleStartCleaning = async () => {
        if (!robot.online) return

        if (robot.type === RobotType.NeatoGen3) {
            if (cleaningCategory === CleaningCategory.SPOT) {
                await GEN3_COMMANDS.startCleaningSpot(
                    robot.serial,
                    spotHeight,
                    spotWidth,
                    gen3Mode,
                    gen3NavMode,
                    gen3Modifier
                )
                getGen3State(robot.serial, robot.name)
                return
            }

            let cat = cleaningCategory
            if (cat === CleaningCategory.MAP && enabledGen3Maps.length === 0) {
                cat = CleaningCategory.HOUSE
            }

            if (cat === CleaningCategory.MAP && selectedZones.length >= 2 && isDocked(robot)) {
                const zonePayload = selectedZones.map(zId => {
                    const zObj = cleaningZones.find(z => z.id === zId)
                    return {
                        id: zId,
                        name: zObj?.name ?? zId,
                        mode: gen3Mode,
                        modifier: gen3Modifier,
                        navigationMode: gen3NavMode,
                    }
                })
                await Http.startZoneQueue(robot.serial, {
                    zones: zonePayload,
                    mode: gen3Mode,
                    modifier: gen3Modifier,
                    navigationMode: gen3NavMode,
                })
                refreshZoneQueue(robot.serial)
                getGen3State(robot.serial, robot.name)
                return
            }

            if (cat === CleaningCategory.MAP && selectedZones.length === 1 && isDocked(robot) && activeMapId) {
                await GEN3_COMMANDS.startCleaningZone(
                    robot.serial,
                    activeMapId,
                    selectedZones[0],
                    gen3Mode,
                    gen3NavMode,
                    gen3Modifier
                )
                getGen3State(robot.serial, robot.name)
                return
            }

            await GEN3_COMMANDS.startCleaning(robot.serial, cat, gen3Mode, gen3NavMode, gen3Modifier)
            getGen3State(robot.serial, robot.name)
            return
        }

        // Gen 4
        if (cleaningCategory === CleaningCategory.HOUSE || !promotedFloorplan) {
            await GEN4_COMMANDS.startCleaning(robot.serial, gen4Mode, gen4NavMode)
            return
        }

        if (selectedZones.length > 0) {
            const runs: Neato.Gen4.SchduleRun[] = selectedZones.map(zId => {
                const ov = zoneOverrides[zId]
                return {
                    map: {
                        rank_id: promotedFloorplan.id,
                        track_id: zId,
                        nogo_enabled: nogoEnabled,
                    },
                    settings: {
                        mode: ov?.mode ?? gen4Mode,
                        navigation_mode: ov?.navigationMode ?? gen4NavMode,
                    },
                }
            })
            await GEN4_COMMANDS.startCleaningRuns(robot.serial, runs)
            return
        }

        await GEN4_COMMANDS.startCleaning(
            robot.serial,
            gen4Mode,
            gen4NavMode,
            promotedFloorplan.id,
            nogoEnabled,
            []
        )
    }

    const encodedSerial = encodeURIComponent(robot.serial)
    const chargePct = robot.details?.charge ?? 0
    const quickBoostActive =
        robot.type === RobotType.NeatoGen4 && !!robot.details?.is_quickboost

    const activeGen3Map = useMemo(
        () => (robot.type === RobotType.NeatoGen3 ? enabledGen3Maps.find(m => m.id === activeMapId) : undefined),
        [robot.type, enabledGen3Maps, activeMapId]
    )

    const basePose = useMemo(() => {
        if (robot.type === RobotType.NeatoGen4 && promotedFloorplan) {
            return extractBasePose(promotedFloorplan)?.pose ?? null
        }
        if (robot.type === RobotType.NeatoGen3 && activeGen3Map) {
            return extractBasePose(activeGen3Map)?.pose ?? null
        }
        return null
    }, [robot.type, promotedFloorplan, activeGen3Map])

    const activeCleaningZoneId = useMemo(() => {
        if (!isBusy) return undefined
        if (activeQueue && (activeQueue.status === 'running' || activeQueue.status === 'in_progress')) {
            return activeQueue.zones[activeQueue.current_index]?.id
        }
        if (robot.type === RobotType.NeatoGen4 && gen4Session?.runs) {
            const runningRun = gen4Session.runs.find(r => r.state === Neato.Gen4.RunStates.IN_PROGRESS)
            if (runningRun?.track_uuid) return runningRun.track_uuid
        }
        if (selectedZones.length === 1 && isBusy) {
            return selectedZones[0]
        }
        return undefined
    }, [isBusy, activeQueue, robot.type, gen4Session, selectedZones])

    const activeCleaningZoneName = useMemo(() => {
        if (!activeCleaningZoneId) return undefined
        const zoneObj = cleaningZones.find(z => z.id === activeCleaningZoneId)
        return zoneObj?.name || activeCleaningZoneId
    }, [activeCleaningZoneId, cleaningZones])

    const renderCleaningSetup = () => (
        <div className={styles.setupCardBody}>
            {/* Category Selector */}
            <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>{t('common.mode', 'Cleaning Scope')}</span>
                <div className={styles.pillRow}>
                    <button
                        type="button"
                        disabled={!isDocked(robot) && robot.online}
                        className={`${styles.pillBtn} ${cleaningCategory === CleaningCategory.MAP ? styles.pillActive : ''}`}
                        onClick={() => setCleaningCategory(CleaningCategory.MAP)}
                    >
                        <HiMap size={16} />
                        <span>{t('home.map', 'Map / Rooms')}</span>
                    </button>
                    <button
                        type="button"
                        className={`${styles.pillBtn} ${cleaningCategory === CleaningCategory.HOUSE ? styles.pillActive : ''}`}
                        onClick={() => setCleaningCategory(CleaningCategory.HOUSE)}
                    >
                        <FaHouse size={15} />
                        <span>{t('home.house', 'Full House')}</span>
                    </button>
                    {supportsSpot && (
                        <button
                            type="button"
                            className={`${styles.pillBtn} ${cleaningCategory === CleaningCategory.SPOT ? styles.pillActive : ''}`}
                            onClick={() => setCleaningCategory(CleaningCategory.SPOT)}
                        >
                            <BiTargetLock size={16} />
                            <span>{t('home.spot', 'Spot')}</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Suction Power */}
            <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>{t('home.btnExplain.cleaning', 'Suction Power')}</span>
                {robot.type === RobotType.NeatoGen3 ? (
                    <div className={styles.pillRow}>
                        <button
                            type="button"
                            className={`${styles.pillBtn} ${gen3Mode === CleaningMode.ECO ? styles.pillActive : ''}`}
                            onClick={() => setGen3Mode(CleaningMode.ECO)}
                        >
                            <TbLeaf size={16} />
                            <span>{t('modes.eco', 'Eco')}</span>
                        </button>
                        <button
                            type="button"
                            className={`${styles.pillBtn} ${gen3Mode === CleaningMode.NORMAL ? styles.pillActive : ''}`}
                            onClick={() => setGen3Mode(CleaningMode.NORMAL)}
                        >
                            <FaFan size={14} />
                            <span>{t('modes.turbo', 'Turbo')}</span>
                        </button>
                    </div>
                ) : (
                    <div className={styles.pillRow}>
                        <button
                            type="button"
                            className={`${styles.pillBtn} ${gen4Mode === Neato.Gen4.CleaningMode.ECO ? styles.pillActive : ''}`}
                            onClick={() => setGen4Mode(Neato.Gen4.CleaningMode.ECO)}
                        >
                            <TbLeaf size={16} />
                            <span>{t('modes.eco', 'Eco')}</span>
                        </button>
                        <button
                            type="button"
                            className={`${styles.pillBtn} ${gen4Mode === Neato.Gen4.CleaningMode.TURBO ? styles.pillActive : ''}`}
                            onClick={() => setGen4Mode(Neato.Gen4.CleaningMode.TURBO)}
                        >
                            <FaFan size={14} />
                            <span>{t('modes.turbo', 'Turbo')}</span>
                        </button>
                        {isGen4D10(robot) && (
                            <>
                                <button
                                    type="button"
                                    className={`${styles.pillBtn} ${gen4Mode === Neato.Gen4.CleaningMode.MAX ? styles.pillActive : ''}`}
                                    onClick={() => setGen4Mode(Neato.Gen4.CleaningMode.MAX)}
                                >
                                    <FaGaugeHigh size={14} />
                                    <span>{t('modes.max', 'Max')}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.pillBtn} ${gen4Mode === Neato.Gen4.CleaningMode.AUTO ? styles.pillActive : ''}`}
                                    onClick={() => setGen4Mode(Neato.Gen4.CleaningMode.AUTO)}
                                >
                                    <MdMotionPhotosAuto size={16} />
                                    <span>{t('modes.auto', 'Auto')}</span>
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Navigation Care & Modifiers */}
            <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>{t('home.btnExplain.navigation', 'Navigation')}</span>
                {robot.type === RobotType.NeatoGen3 ? (
                    <div className={styles.pillRow}>
                        <button
                            type="button"
                            className={`${styles.pillBtn} ${gen3NavMode === CleaningNavigationMode.NORMAL ? styles.pillActive : ''}`}
                            onClick={() => setGen3NavMode(CleaningNavigationMode.NORMAL)}
                        >
                            <MdCleaningServices size={16} />
                            <span>{t('modes.normal', 'Normal')}</span>
                        </button>
                        {supportsExtraCare && (
                            <button
                                type="button"
                                className={`${styles.pillBtn} ${gen3NavMode === CleaningNavigationMode.EXTRA_CARE ? styles.pillActive : ''}`}
                                onClick={() => setGen3NavMode(CleaningNavigationMode.EXTRA_CARE)}
                            >
                                <MdOutlineHealthAndSafety size={16} />
                                <span>{t('modes.extraCare', 'Extra Care')}</span>
                            </button>
                        )}
                        {supportsDeep && (
                            <button
                                type="button"
                                className={`${styles.pillBtn} ${gen3NavMode === CleaningNavigationMode.DEEP ? styles.pillActive : ''}`}
                                onClick={() => setGen3NavMode(CleaningNavigationMode.DEEP)}
                            >
                                <MdAutoAwesome size={16} />
                                <span>{t('modes.deep', 'Deep')}</span>
                            </button>
                        )}
                    </div>
                ) : (
                    <div className={styles.pillRow}>
                        <button
                            type="button"
                            className={`${styles.pillBtn} ${gen4NavMode === Neato.Gen4.CleaningNavigationMode.NORMAL ? styles.pillActive : ''}`}
                            onClick={() => setGen4NavMode(Neato.Gen4.CleaningNavigationMode.NORMAL)}
                        >
                            <MdCleaningServices size={16} />
                            <span>{t('modes.normal', 'Normal')}</span>
                        </button>
                        <button
                            type="button"
                            className={`${styles.pillBtn} ${gen4NavMode === Neato.Gen4.CleaningNavigationMode.GENTLE ? styles.pillActive : ''}`}
                            onClick={() => setGen4NavMode(Neato.Gen4.CleaningNavigationMode.GENTLE)}
                        >
                            <MdOutlineHealthAndSafety size={16} />
                            <span>{t('modes.gentle', 'Gentle')}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Gen 3 2x Pass / Gen 4 No-Go Toggle */}
            {robot.type === RobotType.NeatoGen3 && (
                <div className={styles.inlineToggleRow}>
                    <div className={styles.toggleInfo}>
                        <MdRepeat size={18} color="var(--accent)" />
                        <div>
                            <div className={styles.toggleTitle}>{t('home.doublePass', 'Double Pass (2×)')}</div>
                            <div className={styles.toggleSub}>{t('home.doublePassSub', 'Cross-hatch second pass for thorough pickup')}</div>
                        </div>
                    </div>
                    <Input
                        type="switch"
                        value={gen3Modifier === CleaningModifier.DOUBLE}
                        onChange={checked => setGen3Modifier(checked ? CleaningModifier.DOUBLE : CleaningModifier.NORMAL)}
                    />
                </div>
            )}

            {robot.type === RobotType.NeatoGen4 && cleaningCategory === CleaningCategory.MAP && promotedFloorplan && (
                <div className={styles.inlineToggleRow}>
                    <div className={styles.toggleInfo}>
                        <div>
                            <div className={styles.toggleTitle}>{t('schedule.useNogoLayer', 'Respect No-Go Zones & Lines')}</div>
                        </div>
                    </div>
                    <Input type="switch" value={nogoEnabled} onChange={setNogoEnabled} />
                </div>
            )}

            {/* Gen 3 Floorplan selector if multiple enabled floorplans */}
            {robot.type === RobotType.NeatoGen3 && cleaningCategory === CleaningCategory.MAP && enabledGen3Maps.length > 1 && (
                <Input
                    type="select"
                    label={t('map.floorplan', 'Floorplan')}
                    options={enabledGen3Maps.map(m => ({ value: m.id, label: m.name }))}
                    value={selectedGen3MapId}
                    onChange={val => setSelectedGen3MapId(String(val))}
                />
            )}

            {/* Ordered Room Selector */}
            {cleaningCategory === CleaningCategory.MAP && cleaningZones.length > 0 && (
                <div className={styles.fieldGroup}>
                    <div className={styles.fieldHeaderRow}>
                        <span className={styles.fieldLabel}>
                            {t('schedule.selectZones', 'Rooms to Clean')}
                            {selectedZones.length > 0 ? ` (${selectedZones.length})` : ` — ${t('home.allRoomsDefault', 'Entire Floorplan')}`}
                        </span>
                        {selectedZones.length > 0 && (
                            <button
                                type="button"
                                className={styles.textActionBtn}
                                onClick={() => setSelectedZones([])}
                            >
                                {t('common.clear', 'Clear')}
                            </button>
                        )}
                    </div>
                    <div className={styles.zoneChipsWrap}>
                        {cleaningZones.map(z => {
                            const seqIdx = selectedZones.indexOf(z.id)
                            const selected = seqIdx !== -1
                            return (
                                <button
                                    key={z.id}
                                    type="button"
                                    className={`${styles.zoneChip} ${selected ? styles.zoneChipActive : ''}`}
                                    onClick={() => toggleZone(z.id)}
                                >
                                    {selected && <span className={styles.seqBadge}>{seqIdx + 1}</span>}
                                    <span>{z.name}</span>
                                </button>
                            )
                        })}
                    </div>

                    {/* Ordered Sequence Queue & Per-Room Overrides */}
                    {selectedZones.length > 0 && (
                        <div className={styles.orderedList}>
                            {robot.type === RobotType.NeatoGen3 && selectedZones.length >= 2 && (
                                <div className={styles.queueHint}>
                                    {t('home.gen3QueueHint', 'Vacuula Server will dispatch these rooms sequentially as the robot docks between zones.')}
                                </div>
                            )}
                            {selectedZones.map((zId, idx) => {
                                const z = cleaningZones.find(item => item.id === zId)
                                if (!z) return null
                                const ov = zoneOverrides[zId] ?? {}
                                return (
                                    <div key={zId} className={styles.orderedItem}>
                                        <div className={styles.orderedItemTop}>
                                            <span className={styles.seqBadge}>{idx + 1}</span>
                                            <span className={styles.orderedName}>{z.name}</span>
                                            <div className={styles.orderControls}>
                                                <button
                                                    type="button"
                                                    className={styles.miniIconBtn}
                                                    disabled={idx === 0}
                                                    onClick={() => moveZone(idx, -1)}
                                                    aria-label="Move up"
                                                >
                                                    <IoArrowUp size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.miniIconBtn}
                                                    disabled={idx === selectedZones.length - 1}
                                                    onClick={() => moveZone(idx, 1)}
                                                    aria-label="Move down"
                                                >
                                                    <IoArrowDown size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.miniIconBtn}
                                                    onClick={() => toggleZone(zId)}
                                                    aria-label="Remove room"
                                                >
                                                    <IoClose size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        {robot.type === RobotType.NeatoGen4 && (
                                            <div className={styles.overrideRow}>
                                                <select
                                                    className={styles.overrideSelect}
                                                    value={ov.mode ?? ''}
                                                    aria-label={`${z.name} suction mode`}
                                                    onChange={e =>
                                                        setZoneOverrides(cur => ({
                                                            ...cur,
                                                            [zId]: {
                                                                ...cur[zId],
                                                                mode: (e.target.value || undefined) as Neato.Gen4.CleaningMode | undefined,
                                                            },
                                                        }))
                                                    }
                                                >
                                                    <option value="">{t('home.defaultSuction', 'Default suction')}</option>
                                                    <option value={Neato.Gen4.CleaningMode.ECO}>{t('modes.eco', 'Eco')}</option>
                                                    <option value={Neato.Gen4.CleaningMode.TURBO}>{t('modes.turbo', 'Turbo')}</option>
                                                    <option value={Neato.Gen4.CleaningMode.MAX}>{t('modes.max', 'Max')}</option>
                                                    <option value={Neato.Gen4.CleaningMode.AUTO}>{t('modes.auto', 'Auto')}</option>
                                                </select>
                                                <select
                                                    className={styles.overrideSelect}
                                                    value={ov.navigationMode ?? ''}
                                                    aria-label={`${z.name} navigation mode`}
                                                    onChange={e =>
                                                        setZoneOverrides(cur => ({
                                                            ...cur,
                                                            [zId]: {
                                                                ...cur[zId],
                                                                navigationMode: (e.target.value || undefined) as Neato.Gen4.CleaningNavigationMode | undefined,
                                                            },
                                                        }))
                                                    }
                                                >
                                                    <option value="">{t('home.defaultNav', 'Default nav')}</option>
                                                    <option value={Neato.Gen4.CleaningNavigationMode.NORMAL}>{t('modes.normal', 'Normal')}</option>
                                                    <option value={Neato.Gen4.CleaningNavigationMode.GENTLE}>{t('modes.gentle', 'Gentle')}</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Spot Size Sliders */}
            {cleaningCategory === CleaningCategory.SPOT && (
                <div className={styles.spotSettings}>
                    <div className={styles.sliderSection}>
                        <div className={styles.sliderLabel}>
                            {t('home.height', 'Height')}: <span className={styles.sliderValue}>{formatLength(spotHeight)}</span>
                        </div>
                        <input
                            type="range"
                            min="100"
                            max="400"
                            value={spotHeight}
                            onChange={e => setSpotHeight(Number(e.target.value))}
                            className={styles.sliderInput}
                        />
                    </div>
                    <div className={styles.sliderSection}>
                        <div className={styles.sliderLabel}>
                            {t('home.width', 'Width')}: <span className={styles.sliderValue}>{formatLength(spotWidth)}</span>
                        </div>
                        <input
                            type="range"
                            min="100"
                            max="400"
                            value={spotWidth}
                            onChange={e => setSpotWidth(Number(e.target.value))}
                            className={styles.sliderInput}
                        />
                    </div>
                </div>
            )}

            {!isDocked(robot) && robot.online && (
                <p className={styles.undockedHint}>{t('home.mapModeHint')}</p>
            )}
        </div>
    )

    const hasAlerts =
        (robot.type === RobotType.NeatoGen4 && !!robot.errors?.length) ||
        (robot.type === RobotType.NeatoGen3 && !!(robot.error || robot.alert))

    return (
        <div className={styles.homeWrapper}>
            <div className={styles.homeGrid}>
                {/* ── Left Column: Status, Alerts, Transport & Cleaning Setup ── */}
                <div className={styles.leftCol}>
                    {hasAlerts && (
                        <div className={styles.alerts}>
                            {robot.type === RobotType.NeatoGen4 && robot.errors && (
                                <Gen4AlertCards errors={robot.errors} />
                            )}
                            {robot.type === RobotType.NeatoGen3 && robot.error && (
                                <AlertCard
                                    type="error"
                                    icon={<MdError size={17} />}
                                    title={t('state.error', 'Error')}
                                    sub={robot.error}
                                    robotType={RobotType.NeatoGen3}
                                />
                            )}
                            {robot.type === RobotType.NeatoGen3 && robot.alert && (
                                <AlertCard
                                    type="warning"
                                    icon={<MdWarning size={17} />}
                                    title={t('common.alert', 'Alert')}
                                    sub={robot.alert}
                                    robotType={RobotType.NeatoGen3}
                                    action={t('home.dismissAlert')}
                                    onClick={() => {
                                        GEN3_COMMANDS.dismissCurrentAlert(robot.serial).then(data => {
                                            if ((data.data as any)?.result === 'ok') {
                                                getGen3State(robot.serial, robot.name)
                                            }
                                        })
                                    }}
                                />
                            )}
                        </div>
                    )}

                    {quickBoostActive && (
                        <div className={styles.quickBoostBanner}>
                            <TbBolt size={18} />
                            <span>
                                {t('home.quickBoostCharging', 'QuickBoost fast-charging to finish cleaning')}
                                {robot.type === RobotType.NeatoGen4 && robot.details.quickboost_estimate > 0
                                    ? ` (~${Math.round(robot.details.quickboost_estimate)} min)`
                                    : ''}
                            </span>
                        </div>
                    )}

                    {activeQueue && (
                        <div className={styles.queueCard}>
                            <div className={styles.queueInfo}>
                                <span className={styles.queueTitle}>
                                    {t('home.multiZoneQueue', 'Multi-Zone Queue')}: {activeQueue.current_index + 1} / {activeQueue.total}
                                </span>
                                <span className={styles.queueSub}>
                                    {activeQueue.zones[activeQueue.current_index]?.name ?? ''} (
                                    {activeQueue.status === 'waiting_next'
                                        ? t('home.queueDocking', 'Waiting for dock before next room')
                                        : t('state.cleaning', 'Cleaning')}
                                    )
                                </span>
                            </div>
                            <button
                                type="button"
                                className={styles.queueCancelBtn}
                                onClick={() => {
                                    Http.cancelZoneQueue(robot.serial, true).then(() => refreshZoneQueue(robot.serial))
                                }}
                            >
                                {t('common.cancel', 'Cancel')}
                            </button>
                        </div>
                    )}

                    {/* Hero Status Card */}
                    <section className={styles.heroCard}>
                        <div className={styles.mascotZone}>
                            <div className={styles.statusRing}>
                                <RingProgress
                                    pct={chargePct}
                                    active={robot.online && isBusy}
                                    hasError={hasRobotError(robot)}
                                />
                                <img src={mascot.src} alt={t('home.logoAlt')} className={styles.robotImage} />
                            </div>

                            <div className={styles.heroMeta}>
                                <div className={styles.statusBadge}>
                                    {robot.online && <span className={styles.pulseDot} />}
                                    <span className={styles.statusLabel}>
                                        {robot.online ? t(getRobotStateKey(robot)) : t('common.offline', 'Offline')}
                                    </span>
                                    <span className={styles.statusDivider}>·</span>
                                    <span className={styles.chargeReadout}>
                                        {Math.round(chargePct)}%
                                        {robot.online && isCharging(robot) ? ' ⚡' : ''}
                                    </span>
                                    <HeaderLoadingSpinner size={13} />
                                </div>
                                {robot.online && lastHeartbeat && (
                                    <span className={styles.timeAgo}>
                                        {t('home.updated', 'Updated')}{' '}
                                        <TimeAgo date={lastHeartbeat} formatter={timeAgoFormatter} />
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Transport Bar */}
                        <div className={styles.transportRow}>
                            <button
                                type="button"
                                className={styles.secondaryTransportBtn}
                                disabled={
                                    !robot.online ||
                                    (robot.type === RobotType.NeatoGen3
                                        ? !robot.availableCommands.stop
                                        : !robot.availableCommands.cancel)
                                }
                                onClick={() =>
                                    (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).stopCleaning(
                                        robot.serial
                                    )
                                }
                                title={t('home.stop')}
                            >
                                <FaStop size={18} />
                                <span>{t('home.stop')}</span>
                            </button>

                            {robot.availableCommands.pause ? (
                                <button
                                    type="button"
                                    className={styles.primaryStartBtn}
                                    disabled={!robot.online}
                                    aria-label={t('home.pauseCleaning')}
                                    onClick={() =>
                                        (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).pauseCleaning(
                                            robot.serial
                                        )
                                    }
                                >
                                    <IoMdPause size={32} />
                                </button>
                            ) : robot.availableCommands.resume ? (
                                <button
                                    type="button"
                                    className={styles.primaryStartBtn}
                                    disabled={!robot.online}
                                    aria-label={t('home.resumeCleaning')}
                                    onClick={() =>
                                        (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).resumeCleaning(
                                            robot.serial
                                        )
                                    }
                                >
                                    <IoMdPlay size={32} />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className={`${styles.primaryStartBtn} ${
                                        !robot.online || !robot.availableCommands?.start ? styles.disabled : ''
                                    }`}
                                    disabled={!robot.online || !robot.availableCommands?.start}
                                    aria-label={t('home.startCleaning')}
                                    onClick={handleStartCleaning}
                                >
                                    <IoMdPlay size={32} />
                                </button>
                            )}

                            <button
                                type="button"
                                className={styles.secondaryTransportBtn}
                                disabled={!canDock || dockingLoading}
                                onClick={handleDock}
                                title={t('home.base')}
                            >
                                {dockingLoading ? (
                                    <IoMdRefresh size={20} className={styles.spin} />
                                ) : (
                                    <TbHome size={20} />
                                )}
                                <span>{dockingLoading ? t('home.docking', 'Docking...') : t('home.base')}</span>
                            </button>
                        </div>

                        {dockFeedback && (
                            <div
                                className={`${styles.dockFeedback} ${
                                    dockFeedback.error ? styles.dockFeedbackError : ''
                                }`}
                            >
                                {dockFeedback.message}
                            </div>
                        )}

                        {/* Utility Actions Row */}
                        <div className={styles.utilityRow}>
                            <button
                                type="button"
                                className={styles.utilBtn}
                                disabled={!robot.online}
                                onClick={() => {
                                    setBellAnimating(true)
                                    ;(robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).findMe(
                                        robot.serial
                                    )
                                    setTimeout(() => setBellAnimating(false), BELL_MS)
                                }}
                            >
                                <FaBell size={15} className={bellAnimating ? styles.bellIcon : ''} />
                                <span>{t('home.locate')}</span>
                            </button>

                            {supportsManualDrive && (
                                <Link
                                    to={`/robot/${encodedSerial}/drive`}
                                    className={styles.utilBtn}
                                    title={t('nav.remoteDrive', 'Remote Drive')}
                                >
                                    <IoGameControllerOutline size={17} />
                                    <span>{t('nav.remoteDrive', 'Remote Drive')}</span>
                                </Link>
                            )}

                            {!isDesktop && (
                                <button
                                    type="button"
                                    className={styles.utilBtn}
                                    onClick={() => setMobileSetupOpen(true)}
                                >
                                    <TbAdjustments size={17} />
                                    <span>
                                        {cleaningCategory === CleaningCategory.MAP
                                            ? selectedZones.length > 0
                                                ? `${selectedZones.length} ${t('home.rooms', 'Rooms')}`
                                                : t('home.map')
                                            : cleaningCategory === CleaningCategory.SPOT
                                                ? t('home.spot')
                                                : t('home.house')}
                                    </span>
                                </button>
                            )}
                        </div>
                    </section>

                    {/* Desktop Inline Cleaning Configuration */}
                    {isDesktop && (
                        <section className={styles.setupCard}>
                            <header className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>{t('home.cleaningSetup', 'Cleaning Setup')}</h2>
                            </header>
                            {renderCleaningSetup()}
                        </section>
                    )}
                </div>

                {/* ── Right Column: Interactive Floorplan, Session Telemetry & Stats ── */}
                <div className={styles.rightCol}>
                    <section className={styles.floorplanCard}>
                        <header className={styles.cardHeader}>
                            <div>
                                <h2 className={styles.cardTitle}>
                                    {robot.type === RobotType.NeatoGen4
                                        ? promotedFloorplan?.name ?? t('map.floorplan', 'Active Floorplan')
                                        : enabledGen3Maps.find(m => m.id === activeMapId)?.name ??
                                          t('map.floorplan', 'Active Floorplan')}
                                </h2>
                                <div className={styles.floorplanStatusRow}>
                                    {robot.online && currentlyDocked && (
                                        <span className={styles.dockedStatusPill} title={t('home.robotDockedTooltip', 'Robot is sitting on the charging base')}>
                                            <span className={styles.dockedDot} />
                                            {t('home.robotDockedAtBase', 'Robot at Base')}
                                        </span>
                                    )}
                                    {robot.online && isBusy && activeCleaningZoneName && (
                                        <span className={styles.activeCleaningPill}>
                                            <span className={styles.pulseDot} />
                                            {t('home.cleaningZone', 'In: {{zone}}', { zone: activeCleaningZoneName })}
                                        </span>
                                    )}
                                    {robot.online && isBusy && !activeCleaningZoneName && (
                                        <span className={styles.activeCleaningPill}>
                                            <span className={styles.pulseDot} />
                                            {t('home.activeHouseCleaning', 'Floor Cleaning Active')}
                                        </span>
                                    )}
                                    {activeMapId && cleaningZones.length > 0 && !isBusy && (
                                        <p className={styles.cardSubtitle}>
                                            {t('home.clickRoomHint', 'Click rooms on the map to build your cleaning order')}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className={styles.cardHeaderActions}>
                                {activeMapId && (
                                    <Link
                                        to={`/robot/${encodedSerial}/map?cleanHere=1&map=${encodeURIComponent(activeMapId)}`}
                                        className={`${styles.headerActionBtn} ${!robot.online ? styles.disabled : ''}`}
                                        title={t('map.cleanHere', 'Clean Here')}
                                    >
                                        <MdOutlineCropFree size={16} />
                                        <span>{t('map.cleanHere', 'Clean Here')}</span>
                                    </Link>
                                )}
                                <Link
                                    to={`/robot/${encodedSerial}/map`}
                                    className={styles.headerActionBtn}
                                    title={t('map.manageMaps', 'Map Studio')}
                                >
                                    <IoMapOutline size={16} />
                                    <span>{t('map.manageMaps', 'Map Studio')}</span>
                                </Link>
                            </div>
                        </header>

                        {activeMapId ? (
                            <InteractiveFloorplan
                                mapId={activeMapId}
                                boundaries={boundaries}
                                selectedZoneIds={selectedZones}
                                onToggleZone={toggleZone}
                                basePose={basePose}
                                resolution={promotedFloorplan?.resolution ?? 40}
                                isDocked={currentlyDocked}
                                isCharging={isCharging(robot)}
                                charge={chargePct}
                                isOnline={robot.online}
                                activeZoneId={activeCleaningZoneId}
                            />
                        ) : (
                            <div className={styles.noFloorplanBox}>
                                <IoMapOutline size={32} color="var(--text-dim)" />
                                <p>
                                    {t(
                                        'home.noActiveFloorplan',
                                        'No active floorplan yet. Run a full house clean or promote a saved map in Map Studio.'
                                    )}
                                </p>
                                <Link
                                    to={`/robot/${encodedSerial}/map`}
                                    className={styles.headerActionBtn}
                                >
                                    {t('map.openMapStudio', 'Open Map Studio')}
                                </Link>
                            </div>
                        )}
                    </section>

                    {/* Active Session Telemetry */}
                    {robot.online && isBusy && (
                        <section className={styles.telemetryBanner}>
                            <div className={styles.telemetryHeader}>
                                <span className={styles.pulseDot} />
                                <strong>{t('home.activeSession', 'Active Session Telemetry')}</strong>
                            </div>
                            {robot.type === RobotType.NeatoGen4 && gen4Session ? (
                                <div className={styles.telemetryGrid}>
                                    {activeCleaningZoneName && (
                                        <div>
                                            <span className={styles.telLabel}>{t('home.currentArea', 'Current Area')}</span>
                                            <span className={styles.telVal}>{activeCleaningZoneName}</span>
                                        </div>
                                    )}
                                    <div>
                                        <span className={styles.telLabel}>{t('runs.startedBy', 'Trigger')}</span>
                                        <span className={styles.telVal}>{gen4Session.started_by}</span>
                                    </div>
                                    <div>
                                        <span className={styles.telLabel}>{t('common.mode', 'Type')}</span>
                                        <span className={styles.telVal}>{gen4Session.cleaning_type}</span>
                                    </div>
                                    <div>
                                        <span className={styles.telLabel}>{t('home.roomsProgress', 'Segments')}</span>
                                        <span className={styles.telVal}>
                                            {gen4Session.runs?.filter(r => r.state === Neato.Gen4.RunStates.DONE).length ?? 0}/
                                            {gen4Session.runs?.length ?? 1}
                                        </span>
                                    </div>
                                </div>
                            ) : robot.type === RobotType.NeatoGen3 && robot.cleaning ? (
                                <div className={styles.telemetryGrid}>
                                    {activeCleaningZoneName && (
                                        <div>
                                            <span className={styles.telLabel}>{t('home.currentArea', 'Current Area')}</span>
                                            <span className={styles.telVal}>{activeCleaningZoneName}</span>
                                        </div>
                                    )}
                                    <div>
                                        <span className={styles.telLabel}>{t('home.btnExplain.cleaning', 'Suction')}</span>
                                        <span className={styles.telVal}>
                                            {robot.cleaning.mode === CleaningMode.ECO ? 'Eco' : 'Turbo'}
                                        </span>
                                    </div>
                                    <div>
                                        <span className={styles.telLabel}>{t('home.passes', 'Modifier')}</span>
                                        <span className={styles.telVal}>
                                            {robot.cleaning.modifier === CleaningModifier.DOUBLE ? '2× Double' : '1× Standard'}
                                        </span>
                                    </div>
                                </div>
                            ) : null}
                        </section>
                    )}

                    {/* Stats Strip */}
                    {statsSummary && (
                        <section className={styles.statsRow} aria-label="Cleaning statistics">
                            <div className={styles.statCard}>
                                <div className={styles.statValue}>{formatArea(statsSummary.lastArea)}</div>
                                <div className={styles.statLabel}>{t('home.lastCoverage', 'Last Coverage')}</div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statValue}>
                                    {statsSummary.lastDur}
                                    <span className={styles.statUnit}>min</span>
                                </div>
                                <div className={styles.statLabel}>{t('home.lastDuration', 'Last Run Time')}</div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statValue}>
                                    {statsSummary.avgDur}
                                    <span className={styles.statUnit}>min</span>
                                </div>
                                <div className={styles.statLabel}>{t('home.avgDuration', 'Avg Run Time')}</div>
                            </div>
                            <div className={styles.statCard}>
                                <div className={styles.statValue}>{formatArea(statsSummary.totalArea)}</div>
                                <div className={styles.statLabel}>{t('home.totalCleaned', 'Total Cleaned')}</div>
                            </div>
                        </section>
                    )}
                </div>
            </div>

            {/* Mobile Cleaning Setup Drawer */}
            {!isDesktop && (
                <ResponsivePanel
                    open={mobileSetupOpen}
                    onOpenChange={setMobileSetupOpen}
                    handle={false}
                    openHeightPercent={75}
                    title={t('home.selectMode', 'Cleaning Setup')}
                >
                    {renderCleaningSetup()}
                    <button
                        type="button"
                        className={styles.okButton}
                        onClick={() => setMobileSetupOpen(false)}
                    >
                        {t('common.ok', 'Done')}
                    </button>
                </ResponsivePanel>
            )}
        </div>
    )
}
