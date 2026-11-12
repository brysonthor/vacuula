import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import TimeAgo from 'react-timeago'
import {
    IoArrowForward,
    IoBarChartOutline,
    IoCalendarClearOutline,
    IoCalendarOutline,
    IoCogOutline,
    IoDownloadOutline,
    IoHardwareChipOutline,
    IoMapOutline,
    IoPauseCircleOutline,
    IoTerminalOutline,
} from 'react-icons/io5'
import { IoMdRefresh } from 'react-icons/io'
import { FaBell, FaPlay } from 'react-icons/fa'
import { TbChargingPile, TbHome } from 'react-icons/tb'
import { MdError } from 'react-icons/md'
import Battery from '../../components/battery/Battery'
import { useApp } from '../../context/useApp'
import { Http } from '../../http'
import { GEN3_COMMANDS } from '../../http/gen3'
import { GEN4_COMMANDS } from '../../http/gen4'
import { useTimeAgoFormatter } from '../../i18n/timeago'
import { useMascot } from '../../mascot'
import Loading from '../loading/loading'
import { Neato, RobotType, type QuickRobotEntry, type ServerScheduleItem } from '../../types'
import { getGen3CleaningMode, getGen3NavigationMode, getGen4CleaningMode, getGen4NavigationMode } from '../../utils/modes'
import HeaderLoadingSpinner from '../../components/loading/HeaderLoadingSpinner'
import { computeFleetAverageUptimeSeconds, computeRobotUptimeSeconds, formatUptime } from '../../utils/uptime'
import { summarizeRobotSchedule, type NativeScheduleEventLike, type RobotScheduleSummary } from '../../utils/scheduleSummary'
import RobotStateSvg from './RobotStateSvg'
import styles from './Fleet.module.scss'

export default function Fleet() {
    const { t } = useTranslation()
    const { robots, selectRobot, zoneQueues, serverInfo } = useApp()
    const { mascot } = useMascot()
    const timeAgoFormatter = useTimeAgoFormatter()
    const navigate = useNavigate()
    const [dockingSerials, setDockingSerials] = useState<Record<string, boolean>>({})
    const [scheduleSummaries, setScheduleSummaries] = useState<Record<string, RobotScheduleSummary>>({})
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(Date.now())
        }, 1000)
        return () => clearInterval(timer)
    }, [])

    const robotFetchKey = robots
        ? Object.entries(robots)
            .map(([serial, info]) => `${serial}:${info.connected ? 1 : 0}:${info.type}`)
            .sort()
            .join('|')
        : ''

    useEffect(() => {
        if (!robots || !robotFetchKey) return
        let cancelled = false

        const entriesList = Object.entries(robots)
        entriesList.forEach(([serial, info]) => {
            const serverReq = typeof Http.getServerSchedules === 'function'
                ? Http.getServerSchedules(serial)
                : Promise.resolve({ data: [] as ServerScheduleItem[] })

            const nativeReq = info.connected
                ? (info.type === RobotType.NeatoGen3
                    ? (typeof GEN3_COMMANDS.getSchedule === 'function' ? GEN3_COMMANDS.getSchedule(serial) : null)
                    : (typeof GEN4_COMMANDS.getSchedule === 'function' ? GEN4_COMMANDS.getSchedule(serial) : null))
                : null

            Promise.allSettled([
                serverReq,
                nativeReq ?? Promise.resolve(null),
            ]).then(([serverRes, nativeRes]) => {
                if (cancelled) return

                const serverChecked = serverRes.status === 'fulfilled'
                const serverSchedules = serverChecked && Array.isArray(serverRes.value?.data)
                    ? serverRes.value.data
                    : []

                let nativeChecked = false
                let nativeEnabled = true
                let nativeEvents: NativeScheduleEventLike[] = []

                if (info.connected && nativeReq && nativeRes.status === 'fulfilled' && nativeRes.value) {
                    if (info.type === RobotType.NeatoGen3) {
                        const payload = (nativeRes.value as any)?.data?.data
                        if (payload && typeof payload === 'object') {
                            nativeChecked = true
                            nativeEnabled = payload.enabled !== false
                            nativeEvents = Array.isArray(payload.events) ? payload.events : []
                        }
                    } else {
                        const payload = (nativeRes.value as any)?.data?.body
                        if (payload && typeof payload === 'object') {
                            nativeChecked = true
                            nativeEnabled = payload.enabled !== false
                            nativeEvents = Array.isArray(payload.events) ? payload.events : []
                        }
                    }
                }

                const summary = summarizeRobotSchedule({
                    connected: !!info.connected,
                    nativeChecked,
                    nativeEnabled,
                    nativeEvents,
                    serverChecked,
                    serverSchedules,
                })

                setScheduleSummaries(prev => ({ ...prev, [serial]: summary }))
            })
        })

        return () => {
            cancelled = true
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [robotFetchKey])

    if (!robots) return <Loading />

    const entries = Object.entries(robots)
    const onlineCount = entries.filter(([, r]) => r.connected).length
    const cleaningCount = entries.filter(([, r]) => r.connected && r.state_label === 'cleaning').length
    const alertCount = entries.filter(([, r]) => r.has_error).length
    const scheduledCount = entries.filter(([serial]) => scheduleSummaries[serial]?.status === 'scheduled').length

    const avgUptimeSeconds = computeFleetAverageUptimeSeconds(robots, now)
    const fleetUptimeDisplay = avgUptimeSeconds !== null ? formatUptime(avgUptimeSeconds) : '--'


    const openRobot = (serial: string, subPath = '') => {
        selectRobot(serial)
        navigate(`/robot/${encodeURIComponent(serial)}${subPath}`)
    }

    const handleDownloadCert = async () => {
        const res = await Http.getVacuulaCert()
        const blob = new Blob([res.data], { type: 'application/x-pem-file' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'vacuula.crt'
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleQuickClean = (serial: string, info: QuickRobotEntry) => {
        if (!info.connected) return
        if (info.type === RobotType.NeatoGen3) {
            const cat = info.is_docked ? Neato.Gen3.CleaningCategory.MAP : Neato.Gen3.CleaningCategory.HOUSE
            GEN3_COMMANDS.startCleaning(serial, cat, getGen3CleaningMode(), getGen3NavigationMode())
        } else {
            GEN4_COMMANDS.startCleaning(serial, getGen4CleaningMode(), getGen4NavigationMode())
        }
    }

    const handleQuickDock = async (serial: string, info: QuickRobotEntry) => {
        if (!info.connected || dockingSerials[serial]) return
        setDockingSerials(prev => ({ ...prev, [serial]: true }))
        try {
            await Http.dockRobot(serial)
        } catch (err) {
            console.error('Failed to dock robot', err)
        } finally {
            setDockingSerials(prev => ({ ...prev, [serial]: false }))
        }
    }

    const handleQuickLocate = (serial: string, info: QuickRobotEntry) => {
        if (!info.connected) return
        if (info.type === RobotType.NeatoGen3) {
            GEN3_COMMANDS.findMe(serial)
        } else {
            GEN4_COMMANDS.findMe(serial)
        }
    }

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div className={styles.headerTitleGroup}>
                    <div className={styles.titleRow}>
                        <h1 className={styles.title}>{t('fleet.title', 'Fleet Overview')}</h1>
                        <HeaderLoadingSpinner size={20} />
                    </div>
                    <p className={styles.subtitle}>
                        {t('fleet.subtitle', 'Live status, quick actions, and diagnostics across your Vacuula server.')}
                    </p>
                </div>
                <div className={styles.headerActions}>
                    <button type="button" className={styles.ghostBtn} onClick={() => navigate('/logs')}>
                        <IoTerminalOutline size={17} />
                        <span>{t('nav.serverLogs', 'Server Logs')}</span>
                    </button>
                    <button type="button" className={styles.ghostBtn} onClick={() => navigate('/settings')}>
                        <IoCogOutline size={17} />
                        <span>{t('settings.title', 'Settings')}</span>
                    </button>
                </div>
            </header>

            <section className={styles.kpiGrid} aria-label="Fleet summary">
                <div className={styles.kpiCard}>
                    <span className={styles.kpiValue}>{entries.length}</span>
                    <span className={styles.kpiLabel}>{t('fleet.linkedRobots', 'Linked Robots')}</span>
                </div>
                <div className={styles.kpiCard}>
                    <span className={`${styles.kpiValue} ${onlineCount > 0 ? styles.kpiSuccess : ''}`}>{onlineCount}</span>
                    <span className={styles.kpiLabel}>{t('fleet.onlineNow', 'Online Now')}</span>
                </div>
                <div className={styles.kpiCard}>
                    <span className={`${styles.kpiValue} ${cleaningCount > 0 ? styles.kpiAccent : ''}`}>{cleaningCount}</span>
                    <span className={styles.kpiLabel}>{t('fleet.activeCleanings', 'Cleaning')}</span>
                </div>
                <div className={styles.kpiCard}>
                    <span className={`${styles.kpiValue} ${alertCount > 0 ? styles.kpiErr : ''}`}>{alertCount}</span>
                    <span className={styles.kpiLabel}>{t('fleet.needsAttention', 'Alerts')}</span>
                </div>
                <div
                    className={styles.kpiCard}
                    data-testid="kpi-scheduled"
                    title={t('fleet.scheduledKpiTooltip', '{{scheduled}} of {{total}} robots have an active schedule', {
                        scheduled: scheduledCount,
                        total: entries.length,
                    })}
                >
                    <span className={`${styles.kpiValue} ${scheduledCount > 0 ? styles.kpiSuccess : ''}`}>
                        {scheduledCount}
                    </span>
                    <span className={styles.kpiLabel}>{t('fleet.scheduledKpi', 'Scheduled')}</span>
                </div>
                <div
                    className={styles.kpiCard}
                    data-testid="kpi-uptime"
                    title={
                        onlineCount > 0
                            ? t('fleet.avgUptimeTooltip', 'Average connection uptime across {{count}} online robot(s)', {
                                  count: onlineCount,
                              })
                            : undefined
                    }
                >
                    <span className={`${styles.kpiValue} ${onlineCount > 0 ? styles.kpiAccent : ''} ${styles.kpiUptime}`}>
                        {fleetUptimeDisplay}
                    </span>
                    <span className={styles.kpiLabel}>{t('fleet.fleetUptime', 'Fleet Uptime')}</span>
                </div>
            </section>

            {entries.length === 0 ? (
                <section className={styles.emptyCard}>
                    <img src={mascot.src} alt="" className={styles.emptyMascot} />
                    <h2 className={styles.emptyTitle}>{t('require.noRobots.title', 'No robots linked yet')}</h2>
                    <p className={styles.emptyDesc}>
                        {t(
                            'fleet.onboardingDesc',
                            'Point your Neato Gen 3 (port {{gen3}}) or Gen 4 (port {{gen4}}) robot to this Vacuula server. It will appear here automatically as soon as it connects.',
                            { gen3: serverInfo?.gen3_port ?? 8080, gen4: serverInfo?.gen4_port ?? 8081 }
                        )}
                    </p>
                    <div className={styles.emptyActions}>
                        <button type="button" className={styles.primaryBtn} onClick={handleDownloadCert}>
                            <IoDownloadOutline size={18} />
                            <span>{t('settings.downloadCert', 'Download SSL Certificate')}</span>
                        </button>
                        <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/settings')}>
                            <IoCogOutline size={18} />
                            <span>{t('fleet.configureNotifications', 'Configure Notifications')}</span>
                        </button>
                        <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/logs')}>
                            <IoTerminalOutline size={18} />
                            <span>{t('nav.serverLogs', 'View Server Logs')}</span>
                        </button>
                    </div>
                </section>
            ) : (
                <section className={styles.cardsGrid}>
                    {entries.map(([serial, info]) => {
                        const queue = zoneQueues[serial]
                        const scheduleSummary = scheduleSummaries[serial]
                        const scheduleStatus = scheduleSummary?.status
                        const scheduleTitle = scheduleStatus === 'scheduled'
                            ? t('fleet.scheduleTooltipActive', 'Schedule active ({{native}} native, {{server}} server) — click to manage', {
                                native: scheduleSummary.nativeActiveCount,
                                server: scheduleSummary.serverActiveCount,
                            })
                            : scheduleStatus === 'paused'
                                ? t('fleet.scheduleTooltipPaused', 'Schedule paused ({{total}} configured) — click to manage', {
                                    total: scheduleSummary.totalCount,
                                })
                                : scheduleStatus === 'none'
                                    ? t('fleet.scheduleTooltipNone', 'No cleaning schedule configured — click to set up')
                                    : t('nav.schedule', 'Schedule')
                        const genLabel = info.type === RobotType.NeatoGen3 ? 'Gen 3' : 'Gen 4'
                        const stateDisplay = !info.connected
                            ? t('common.offline', 'Offline')
                            : info.state_label
                                ? t(`state.${info.state_label}`, info.state_label)
                                : t('state.idle', 'Idle')

                        return (
                            <article
                                key={serial}
                                className={`${styles.robotCard} ${!info.connected ? styles.cardOffline : ''}`}
                            >
                                <div className={styles.cardTop}>
                                    <div className={styles.cardIdentity}>
                                        <div className={styles.titleLine}>
                                            <span
                                                className={`${styles.liveDot} ${
                                                    !info.connected
                                                        ? styles.dotOffline
                                                        : info.has_error
                                                            ? styles.dotErr
                                                            : styles.dotOnline
                                                }`}
                                            />
                                            <h2 className={styles.robotName}>{info.name}</h2>
                                        </div>
                                        <div className={styles.badgeRow}>
                                            <span className={styles.genBadge}>{genLabel}</span>
                                            {info.model && <span className={styles.metaTag}>{info.model}</span>}
                                            {info.firmware && <span className={styles.metaTag}>FW {info.firmware}</span>}
                                            {scheduleStatus && scheduleStatus !== 'unknown' && scheduleStatus !== 'loading' && (
                                                <button
                                                    type="button"
                                                    data-testid={`schedule-badge-${serial}`}
                                                    className={`${styles.scheduleBadge} ${
                                                        scheduleStatus === 'scheduled'
                                                            ? styles.scheduleActive
                                                            : scheduleStatus === 'paused'
                                                                ? styles.schedulePaused
                                                                : styles.scheduleNone
                                                    }`}
                                                    onClick={() => openRobot(serial, '/schedule')}
                                                    title={scheduleTitle}
                                                >
                                                    {scheduleStatus === 'scheduled' ? (
                                                        <IoCalendarOutline size={12} />
                                                    ) : scheduleStatus === 'paused' ? (
                                                        <IoPauseCircleOutline size={12} />
                                                    ) : (
                                                        <IoCalendarClearOutline size={12} />
                                                    )}
                                                    <span>
                                                        {scheduleStatus === 'scheduled'
                                                            ? t('fleet.scheduleActive', 'Scheduled')
                                                            : scheduleStatus === 'paused'
                                                                ? t('fleet.schedulePaused', 'Schedule Paused')
                                                                : t('fleet.scheduleNone', 'No Schedule')}
                                                    </span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className={styles.batteryWrap}>
                                        {info.connected && info.is_docked && (
                                            <TbChargingPile size={16} className={styles.dockIcon} title={t('topbar.docked')} />
                                        )}
                                        <Battery
                                            percentage={typeof info.charge === 'number' ? info.charge : 0}
                                            isCharging={!!(info.connected && info.is_charging)}
                                        />
                                    </div>
                                </div>

                                <div className={styles.statusStrip}>
                                    <div className={styles.statusMain}>
                                        <span className={styles.statusPill}>
                                            <RobotStateSvg
                                                connected={!!info.connected}
                                                stateLabel={info.state_label}
                                                hasError={!!info.has_error}
                                                isCharging={!!(info.connected && info.is_charging)}
                                                label={stateDisplay}
                                            />
                                        </span>
                                        {info.ip_address && (
                                            <span className={styles.ipLabel}>{info.ip_address}</span>
                                        )}
                                    </div>
                                    {!info.connected && info.last_seen_at && (
                                        <span className={styles.lastSeen}>
                                            {t('fleet.lastSeen', 'Seen')}{' '}
                                            <TimeAgo date={info.last_seen_at} formatter={timeAgoFormatter} />
                                        </span>
                                    )}
                                    {info.connected && (
                                        <span className={styles.robotUptime} data-testid={`uptime-${serial}`}>
                                            {t('fleet.uptime', 'Uptime')}{' '}
                                            {formatUptime(computeRobotUptimeSeconds(info, now) ?? 0)}
                                        </span>
                                    )}
                                </div>

                                {info.has_error && (
                                    <div className={styles.errorBanner}>
                                        <MdError size={16} />
                                        <span>
                                            {info.error_code
                                                ? t(`robotErrorCode.${info.type}.${info.error_code}`, info.error_code)
                                                : t('state.error', 'Attention required')}
                                        </span>
                                    </div>
                                )}

                                {queue && (
                                    <div className={styles.queueBanner}>
                                        <span>
                                            {t('fleet.queueProgress', 'Zone Queue')}: {queue.current_index + 1}/{queue.total} (
                                            {queue.zones[queue.current_index]?.name ?? 'Zone'})
                                        </span>
                                    </div>
                                )}

                                <div className={styles.quickBar}>
                                    <button
                                        type="button"
                                        className={styles.quickActionBtn}
                                        disabled={!info.connected || info.state_label === 'cleaning'}
                                        onClick={() => handleQuickClean(serial, info)}
                                        title={t('home.startCleaning', 'Start cleaning')}
                                    >
                                        <FaPlay size={12} />
                                        <span>{t('fleet.clean', 'Clean')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.quickActionBtn}
                                        disabled={!info.connected || !!info.is_docked || dockingSerials[serial]}
                                        onClick={() => handleQuickDock(serial, info)}
                                        title={t('home.base', 'Dock')}
                                    >
                                        {dockingSerials[serial] ? (
                                            <IoMdRefresh size={15} className={styles.spin} />
                                        ) : (
                                            <TbHome size={15} />
                                        )}
                                        <span>{dockingSerials[serial] ? t('home.docking', 'Docking...') : t('home.base', 'Base')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.quickActionBtn}
                                        disabled={!info.connected}
                                        onClick={() => handleQuickLocate(serial, info)}
                                        title={t('home.locate', 'Locate')}
                                    >
                                        <FaBell size={13} />
                                        <span>{t('home.locate', 'Locate')}</span>
                                    </button>
                                </div>

                                <div className={styles.cardFooter}>
                                    <div className={styles.shortcutIcons}>
                                        <button
                                            type="button"
                                            className={styles.iconLinkBtn}
                                            onClick={() => openRobot(serial, '/map')}
                                            title={t('nav.mapsZones', 'Maps & Zones')}
                                        >
                                            <IoMapOutline size={17} />
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.iconLinkBtn}
                                            onClick={() => openRobot(serial, '/runs')}
                                            title={t('nav.runHistory', 'Run History')}
                                        >
                                            <IoBarChartOutline size={17} />
                                        </button>
                                        <button
                                            type="button"
                                            data-testid={`schedule-shortcut-${serial}`}
                                            className={`${styles.iconLinkBtn} ${
                                                scheduleStatus === 'scheduled'
                                                    ? styles.iconLinkScheduled
                                                    : scheduleStatus === 'paused'
                                                        ? styles.iconLinkPaused
                                                        : ''
                                            }`}
                                            onClick={() => openRobot(serial, '/schedule')}
                                            title={scheduleTitle}
                                        >
                                            <IoCalendarOutline size={17} />
                                            {(scheduleStatus === 'scheduled' || scheduleStatus === 'paused') && (
                                                <span
                                                    className={`${styles.iconStatusDot} ${
                                                        scheduleStatus === 'paused' ? styles.iconStatusDotPaused : ''
                                                    }`}
                                                />
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.iconLinkBtn}
                                            onClick={() => openRobot(serial, '/settings')}
                                            title={t('nav.robotMaintenance', 'Robot & Maintenance')}
                                        >
                                            <IoHardwareChipOutline size={17} />
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.openWorkspaceBtn}
                                        onClick={() => openRobot(serial)}
                                    >
                                        <span>
                                            {info.connected
                                                ? t('fleet.openWorkspace', 'Open Workspace')
                                                : t('fleet.inspectOffline', 'Inspect History & Maps')}
                                        </span>
                                        <IoArrowForward size={15} />
                                    </button>
                                </div>
                            </article>
                        )
                    })}
                </section>
            )}
        </div>
    )
}
