import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import styles from './robotSwitcher.module.scss'
import { TbChevronDown, TbLayoutGrid } from 'react-icons/tb'
import { useApp } from '../../context/useApp'
import { useTranslation } from 'react-i18next'

export default function RobotSwitcher({ icon, children }: { icon?: ReactNode; children?: ReactNode }) {
    const { t } = useTranslation()
    const { robot, robots, selectRobot } = useApp()
    const navigate = useNavigate()
    const location = useLocation()

    const [isOpen, setIsOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!isOpen) return
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [isOpen])

    const entries = Object.entries(robots ?? {})
    const isFleetView = location.pathname === '/'
    const isGlobalRoute = isFleetView || location.pathname === '/settings' || location.pathname === '/logs'
    const selected = robot && robots ? robots[robot.serial] : undefined

    const headerLabel = isFleetView
        ? t('nav.fleetOverview', 'Fleet Overview')
        : location.pathname === '/settings'
            ? t('settings.title', 'Settings')
            : location.pathname === '/logs'
                ? t('nav.serverLogs', 'Server Logs')
                : (selected?.name ?? robot?.name ?? t('topbar.selectARobot'))

    return (
        <div className={styles.container} ref={containerRef}>
            <button
                className={styles.trigger}
                onClick={() => setIsOpen(o => !o)}
                aria-label={t('topbar.selectRobot')}
                aria-expanded={isOpen}
            >
                {isGlobalRoute ? <TbLayoutGrid size={22} color="var(--accent)" /> : icon}
                <span className={styles.name}>{headerLabel}</span>
                {!isGlobalRoute && children}
                <TbChevronDown
                    size={14}
                    className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
                    aria-hidden="true"
                />
            </button>

            {isOpen && (
                <div className={styles.dropdown} role="listbox">
                    <button
                        role="option"
                        aria-selected={isFleetView}
                        className={`${styles.dropdownItem} ${isFleetView ? styles.dropdownItemActive : ''}`}
                        onClick={() => {
                            navigate('/')
                            setIsOpen(false)
                        }}
                    >
                        <span className={styles.dropdownName}>{t('nav.fleetOverview', 'Fleet Overview')}</span>
                        <span className={styles.fleetCountPill}>{entries.length}</span>
                    </button>

                    {entries.map(([serial, info]) => {
                        const isSelected = !isGlobalRoute && serial === robot?.serial
                        return (
                            <button
                                key={serial}
                                role="option"
                                aria-selected={isSelected}
                                className={[
                                    styles.dropdownItem,
                                    isSelected ? styles.dropdownItemActive : '',
                                    !info.connected ? styles.dropdownItemOffline : '',
                                ].join(' ')}
                                onClick={() => {
                                    selectRobot(serial)
                                    // Preserve sub-route if already inside /robot/:oldSerial/:sub
                                    const match = location.pathname.match(/^\/robot\/[^/]+(\/.*)?$/)
                                    const sub = match?.[1] ?? ''
                                    navigate(`/robot/${encodeURIComponent(serial)}${sub}`)
                                    setIsOpen(false)
                                }}
                            >
                                <span className={styles.dropdownName}>{info.name}</span>
                                <div className={styles.dropdownMeta}>
                                    {typeof info.charge === 'number' && (
                                        <span className={styles.chargeTag}>{Math.round(info.charge)}%</span>
                                    )}
                                    {!info.connected && <span className={styles.offlineTag}>{t('common.offline')}</span>}
                                    {isSelected && <span className={styles.dropdownCheck}>✓</span>}
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
