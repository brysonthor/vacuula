import styles from './navbar.module.scss'
import { NavLink, useLocation } from 'react-router'
import {
    IoBarChartOutline,
    IoCalendarOutline,
    IoCogOutline,
    IoHardwareChipOutline,
    IoHomeOutline,
    IoMapOutline,
    IoTerminalOutline,
} from 'react-icons/io5'
import { TbLayoutGrid } from 'react-icons/tb'
import { useApp } from '../../context/useApp'

export default function Navbar() {
    const { robot } = useApp()
    const location = useLocation()
    const match = location.pathname.match(/^\/robot\/([^/]+)/)
    const activeSerial = match ? decodeURIComponent(match[1]) : undefined
    const encodedSerial = activeSerial ? encodeURIComponent(activeSerial) : robot ? encodeURIComponent(robot.serial) : ''

    if (activeSerial) {
        return (
            <nav className={styles.navbar} aria-label="Workspace navigation">
                <Link to={`/robot/${encodedSerial}/runs`} label="Runs">
                    <IoBarChartOutline size={23} />
                </Link>
                <Link to={`/robot/${encodedSerial}/map`} label="Map">
                    <IoMapOutline size={23} />
                </Link>
                <Link to={`/robot/${encodedSerial}`} end label="Control">
                    <IoHomeOutline size={24} />
                </Link>
                <Link to={`/robot/${encodedSerial}/schedule`} label="Schedule">
                    <IoCalendarOutline size={23} />
                </Link>
                <Link to={`/robot/${encodedSerial}/settings`} label="Robot">
                    <IoHardwareChipOutline size={23} />
                </Link>
                <Link to="/settings" label="App">
                    <IoCogOutline size={23} />
                </Link>
            </nav>
        )
    }

    return (
        <nav className={styles.navbar} aria-label="Main navigation">
            <Link to="/" end label="Fleet">
                <TbLayoutGrid size={24} />
            </Link>
            {encodedSerial && (
                <Link to={`/robot/${encodedSerial}`} label="Robot">
                    <IoHomeOutline size={24} />
                </Link>
            )}
            <Link to="/logs" label="Logs">
                <IoTerminalOutline size={23} />
            </Link>
            <Link to="/settings" label="Settings">
                <IoCogOutline size={24} />
            </Link>
        </nav>
    )
}

const Link = ({
    to,
    end,
    label,
    children,
}: {
    to: string
    end?: boolean
    label: string
    children: React.ReactNode
}) => (
    <NavLink
        to={to}
        end={end}
        aria-label={label}
        className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
    >
        {children}
        <span className={styles.label}>{label}</span>
    </NavLink>
)
