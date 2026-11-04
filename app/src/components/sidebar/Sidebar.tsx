import { useState } from 'react'
import { matchPath, NavLink, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
    IoBarChartOutline,
    IoCalendarOutline,
    IoCogOutline,
    IoGameControllerOutline,
    IoHardwareChipOutline,
    IoHomeOutline,
    IoMapOutline,
    IoTerminalOutline,
} from 'react-icons/io5'
import {
    TbLayoutGrid,
    TbLayoutSidebarLeftCollapse,
    TbLayoutSidebarLeftExpand,
} from 'react-icons/tb'
import { MdError } from 'react-icons/md'
import { useApp } from '../../context/useApp'
import { useMascot } from '../../mascot'
import { RobotType } from '../../types'
import HeaderLoadingSpinner from '../loading/HeaderLoadingSpinner'
import styles from './Sidebar.module.scss'

const STORAGE_KEY = 'vacuula.sidebarCollapsed'

export default function Sidebar() {
    const { t } = useTranslation()
    const { robots, serverInfo } = useApp()
    const { mascot } = useMascot()
    const location = useLocation()

    const [collapsed, setCollapsed] = useState<boolean>(() => {
        return localStorage.getItem(STORAGE_KEY) === 'true'
    })

    const toggleCollapsed = () => {
        setCollapsed(c => {
            const next = !c
            localStorage.setItem(STORAGE_KEY, String(next))
            return next
        })
    }

    const robotEntries = Object.entries(robots ?? {})
    const robotMatch = matchPath({ path: '/robot/:serial', end: false }, location.pathname)
    const activeSerial = robotMatch?.params.serial ? decodeURIComponent(robotMatch.params.serial) : undefined
    const activeEntry = activeSerial && robots ? robots[activeSerial] : undefined
    const encodedSerial = activeSerial ? encodeURIComponent(activeSerial) : ''

    const subMatch = location.pathname.match(/^\/robot\/[^/]+(\/.*)?$/)
    const sub = subMatch?.[1] ?? ''
    const cleanSub = sub === '/' ? '' : sub

    const showDrive = activeEntry?.type === RobotType.NeatoGen3

    return (
        <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
            <div className={styles.brandRow}>
                <NavLink
                    to="/"
                    className={styles.brandBtn}
                    title="Vacuula"
                >
                    <img src={mascot.src} alt="" className={styles.brandLogo} />
                    {!collapsed ? (
                        <div className={styles.brandText}>
                            <div className={styles.brandTitleRow}>
                                <span className={styles.brandName}>Vacuula</span>
                                <HeaderLoadingSpinner size={14} />
                            </div>
                            <span className={styles.brandVer}>v{serverInfo?.version}</span>
                        </div>
                    ) : (
                        <HeaderLoadingSpinner size={14} />
                    )}
                </NavLink>
                <button
                    type="button"
                    className={styles.collapseBtn}
                    onClick={toggleCollapsed}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? <TbLayoutSidebarLeftExpand size={19} /> : <TbLayoutSidebarLeftCollapse size={19} />}
                </button>
            </div>

            <div className={styles.scrollArea}>
                {/* Global Navigation */}
                <div className={styles.section}>
                    {!collapsed && <div className={styles.sectionLabel}>{t('nav.overview', 'Overview')}</div>}
                    <NavLink
                        to="/"
                        end
                        className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                        title={t('nav.fleetOverview', 'Fleet Overview')}
                    >
                        <TbLayoutGrid size={20} className={styles.navIcon} />
                        {!collapsed && <span className={styles.navText}>{t('nav.fleetOverview', 'Fleet Overview')}</span>}
                        {!collapsed && robotEntries.length > 0 && (
                            <span className={styles.countBadge}>{robotEntries.length}</span>
                        )}
                    </NavLink>
                </div>

                {/* Linked Robots Fleet Switcher */}
                {robotEntries.length > 0 && (
                    <div className={styles.section}>
                        {!collapsed && <div className={styles.sectionLabel}>{t('nav.robots', 'Robots')}</div>}
                        <div className={styles.robotList}>
                            {robotEntries.map(([serial, info]) => {
                                const isCurrent = activeSerial === serial
                                const safeSub = cleanSub === '/drive' && info.type !== RobotType.NeatoGen3 ? '' : cleanSub
                                const targetPath = `/robot/${encodeURIComponent(serial)}${safeSub}`

                                return (
                                    <NavLink
                                        key={serial}
                                        to={targetPath}
                                        className={`${styles.robotRow} ${isCurrent ? styles.robotRowActive : ''}`}
                                        title={`${info.name} (${info.connected ? t('common.online', 'Online') : t('common.offline', 'Offline')})`}
                                    >
                                        <span
                                            className={`${styles.statusDot} ${
                                                !info.connected
                                                    ? styles.dotOffline
                                                    : info.has_error
                                                        ? styles.dotError
                                                        : styles.dotOnline
                                            }`}
                                        />
                                        {!collapsed && (
                                            <>
                                                <div className={styles.robotRowMain}>
                                                    <span className={styles.robotRowName}>{info.name}</span>
                                                    <span className={styles.robotRowSub}>
                                                        {!info.connected
                                                            ? t('common.offline', 'Offline')
                                                            : info.state_label
                                                                ? t(`state.${info.state_label}`, info.state_label)
                                                                : t('state.idle', 'Idle')}
                                                    </span>
                                                </div>
                                                <div className={styles.robotRowRight}>
                                                    {info.has_error && <MdError size={14} className={styles.errIcon} />}
                                                    {typeof info.charge === 'number' && (
                                                        <span className={styles.chargeText}>{Math.round(info.charge)}%</span>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </NavLink>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Active Robot Workspace Navigation */}
                {activeSerial && activeEntry && (
                    <div className={styles.section}>
                        {!collapsed && (
                            <div className={styles.sectionLabel}>
                                {activeEntry.name}
                            </div>
                        )}
                        <NavLink
                            to={`/robot/${encodedSerial}`}
                            end
                            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                            title={t('nav.commandCenter', 'Command Center')}
                        >
                            <IoHomeOutline size={19} className={styles.navIcon} />
                            {!collapsed && <span className={styles.navText}>{t('nav.commandCenter', 'Command Center')}</span>}
                        </NavLink>

                        <NavLink
                            to={`/robot/${encodedSerial}/map`}
                            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                            title={t('nav.mapsZones', 'Maps & Zones')}
                        >
                            <IoMapOutline size={19} className={styles.navIcon} />
                            {!collapsed && <span className={styles.navText}>{t('nav.mapsZones', 'Maps & Zones')}</span>}
                        </NavLink>

                        <NavLink
                            to={`/robot/${encodedSerial}/runs`}
                            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                            title={t('nav.runHistory', 'Run History')}
                        >
                            <IoBarChartOutline size={19} className={styles.navIcon} />
                            {!collapsed && <span className={styles.navText}>{t('nav.runHistory', 'Run History')}</span>}
                        </NavLink>

                        <NavLink
                            to={`/robot/${encodedSerial}/schedule`}
                            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                            title={t('nav.schedule', 'Schedule')}
                        >
                            <IoCalendarOutline size={19} className={styles.navIcon} />
                            {!collapsed && <span className={styles.navText}>{t('nav.schedule', 'Schedule')}</span>}
                        </NavLink>

                        {showDrive && (
                            <NavLink
                                to={`/robot/${encodedSerial}/drive`}
                                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                                title={t('nav.remoteDrive', 'Remote Drive')}
                            >
                                <IoGameControllerOutline size={19} className={styles.navIcon} />
                                {!collapsed && <span className={styles.navText}>{t('nav.remoteDrive', 'Remote Drive')}</span>}
                            </NavLink>
                        )}

                        <NavLink
                            to={`/robot/${encodedSerial}/settings`}
                            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                            title={t('nav.robotMaintenance', 'Robot & Maintenance')}
                        >
                            <IoHardwareChipOutline size={19} className={styles.navIcon} />
                            {!collapsed && <span className={styles.navText}>{t('nav.robotMaintenance', 'Robot & Maintenance')}</span>}
                        </NavLink>
                    </div>
                )}
            </div>

            {/* Bottom System Links */}
            <div className={styles.footerSection}>
                <NavLink
                    to="/logs"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                    title={t('nav.serverLogs', 'Server Logs')}
                >
                    <IoTerminalOutline size={19} className={styles.navIcon} />
                    {!collapsed && <span className={styles.navText}>{t('nav.serverLogs', 'Server Logs')}</span>}
                </NavLink>
                <NavLink
                    to="/settings"
                    className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                    title={t('nav.appSettings', 'App & Server Settings')}
                >
                    <IoCogOutline size={19} className={styles.navIcon} />
                    {!collapsed && <span className={styles.navText}>{t('nav.appSettings', 'App & Server Settings')}</span>}
                </NavLink>
            </div>
        </aside>
    )
}
