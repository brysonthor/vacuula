import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
    IoArrowBackOutline,
    IoArrowDownOutline,
    IoArrowForwardOutline,
    IoArrowRedoOutline,
    IoArrowUndoOutline,
    IoArrowUpOutline,
    IoGameControllerOutline,
    IoPlayOutline,
    IoStopCircleOutline,
    IoStopOutline,
    IoWifiOutline,
} from 'react-icons/io5'
import { useRobot } from '../../context/useRobot'
import { Http } from '../../http'
import { RobotType, type DriveCombo, type DriveCommand, type DriveStatus } from '../../types'
import styles from './Drive.module.scss'

const KEY_TO_COMBO: Record<string, DriveCombo> = {
    w: 'forward',
    arrowup: 'forward',
    s: 'back',
    arrowdown: 'back',
    a: 'pivot-left',
    arrowleft: 'pivot-left',
    d: 'pivot-right',
    arrowright: 'pivot-right',
    q: 'arc-left',
    e: 'arc-right',
    ' ': 'stop',
}

function extractErrMsg(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const resp = (err as { response?: { data?: { message?: string } } }).response
        if (resp?.data?.message) return resp.data.message
    }
    return fallback
}

export default function Drive() {
    const navigate = useNavigate()
    const { robot } = useRobot()

    const [status, setStatus] = useState<DriveStatus>({ connected: false })
    const [starting, setStarting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [activeCombo, setActiveCombo] = useState<DriveCombo | null>(null)

    const activeComboRef = useRef<DriveCombo | null>(null)
    const connectedRef = useRef<boolean>(false)

    useEffect(() => {
        connectedRef.current = status.connected
    }, [status.connected])

    const sendCombo = useCallback(
        async (combo: DriveCombo) => {
            if (!connectedRef.current) return
            try {
                const res = await Http.driveInput(robot.serial, { combo })
                setStatus(res.data)
            } catch (err: unknown) {
                setError(extractErrMsg(err, 'Drive command failed.'))
                setActiveCombo(null)
                activeComboRef.current = null
            }
        },
        [robot.serial]
    )

    const sendCommand = useCallback(
        async (command: DriveCommand) => {
            if (!connectedRef.current) return
            try {
                const res = await Http.driveInput(robot.serial, { command })
                setStatus(res.data)
            } catch (err: unknown) {
                setError(extractErrMsg(err, 'Hardware toggle failed.'))
            }
        },
        [robot.serial]
    )

    const stopMotion = useCallback(() => {
        if (activeComboRef.current !== null) {
            activeComboRef.current = null
            setActiveCombo(null)
        }
        if (connectedRef.current) {
            void sendCombo('stop')
        }
    }, [sendCombo])

    const engageCombo = useCallback(
        (combo: DriveCombo) => {
            if (!connectedRef.current) return
            if (combo === 'stop') {
                stopMotion()
                return
            }
            activeComboRef.current = combo
            setActiveCombo(combo)
            void sendCombo(combo)
        },
        [sendCombo, stopMotion]
    )

    // Refresh status on mount and poll every 5s while connected
    useEffect(() => {
        if (robot.type !== RobotType.NeatoGen3) return
        Http.driveStatus(robot.serial)
            .then((res) => setStatus(res.data))
            .catch(() => {})
    }, [robot.serial, robot.type])

    useEffect(() => {
        if (!status.connected) return
        const id = setInterval(() => {
            Http.driveStatus(robot.serial)
                .then((res) => setStatus(res.data))
                .catch(() => {})
        }, 5000)
        return () => clearInterval(id)
    }, [status.connected, robot.serial])

    // Deadman heartbeat every 450ms while a motion combo is held
    useEffect(() => {
        if (!status.connected || !activeCombo || activeCombo === 'stop') return
        const id = setInterval(() => {
            if (activeComboRef.current && activeComboRef.current !== 'stop') {
                void sendCombo(activeComboRef.current)
            }
        }, 450)
        return () => clearInterval(id)
    }, [status.connected, activeCombo, sendCombo])

    // Keyboard & window blur safety handlers
    useEffect(() => {
        if (!status.connected) return

        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
            const mapped = KEY_TO_COMBO[e.key.toLowerCase()]
            if (!mapped) return
            e.preventDefault()
            if (e.repeat) return
            engageCombo(mapped)
        }

        const onKeyUp = (e: KeyboardEvent) => {
            const mapped = KEY_TO_COMBO[e.key.toLowerCase()]
            if (!mapped) return
            e.preventDefault()
            if (mapped === activeComboRef.current) {
                stopMotion()
            }
        }

        const onBlurOrHide = () => stopMotion()

        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener('blur', onBlurOrHide)
        document.addEventListener('visibilitychange', onBlurOrHide)

        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
            window.removeEventListener('blur', onBlurOrHide)
            document.removeEventListener('visibilitychange', onBlurOrHide)
        }
    }, [status.connected, engageCombo, stopMotion])

    // Always release session / stop motors on unmount
    useEffect(() => {
        const serial = robot.serial
        return () => {
            if (connectedRef.current) {
                void Http.driveStop(serial).catch(() => {})
            }
        }
    }, [robot.serial])

    const handleStartSession = async () => {
        if (!robot.online || starting) return
        setStarting(true)
        setError(null)
        try {
            const res = await Http.driveStart(robot.serial)
            setStatus(res.data)
        } catch (err: unknown) {
            setError(
                extractErrMsg(
                    err,
                    'Could not open direct LAN WebSocket drive session to robot.'
                )
            )
        } finally {
            setStarting(false)
        }
    }

    const handleStopSession = async () => {
        activeComboRef.current = null
        setActiveCombo(null)
        try {
            await Http.driveStop(robot.serial)
            setStatus({ connected: false })
        } catch {
            setStatus({ connected: false })
        }
    }

    if (robot.type !== RobotType.NeatoGen3) {
        return (
            <div className={styles.page}>
                <div className={styles.card}>
                    <h2>Manual Remote Drive Not Supported</h2>
                    <p className={styles.sub}>
                        Direct LAN WebSocket manual drive (`ws://&lt;robot-ip&gt;/drive`) is available exclusively on Neato Gen 3 (Botvac Connected / D3–D7) firmware.
                    </p>
                    <div>
                        <button
                            type="button"
                            className={`${styles.btn} ${styles.primary}`}
                            onClick={() => navigate(`/robot/${encodeURIComponent(robot.serial)}`)}
                        >
                            Back to Command Center
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    const bindPadPointer = (combo: DriveCombo) => ({
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            engageCombo(combo)
        },
        onPointerUp: () => stopMotion(),
        onPointerCancel: () => stopMotion(),
    })

    const robotMessage = status.robot_message
        ? typeof status.robot_message === 'string'
            ? status.robot_message
            : status.robot_message.error ||
              status.robot_message.alert ||
              status.robot_message.message ||
              null
        : null

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div className={styles.titleGroup}>
                    <h1>
                        <IoGameControllerOutline size={24} /> Manual Remote Drive — {robot.name}
                    </h1>
                    <p>
                        Low-latency LAN WebSocket control with automatic 1.5s deadman motor cutoff.
                    </p>
                    <div className={styles.sessionMeta}>
                        <span
                            className={`${styles.metaBadge} ${status.connected ? styles.connected : ''}`}
                        >
                            {status.connected ? 'Drive Session Active' : 'Disconnected'}
                        </span>
                        {status.ip_address && (
                            <span className={styles.metaBadge}>
                                ws://{status.ip_address}:{status.port ?? 8080}/drive
                            </span>
                        )}
                        {status.ssid && (
                            <span className={styles.metaBadge}>
                                <IoWifiOutline size={14} /> {status.ssid}
                            </span>
                        )}
                    </div>
                </div>

                <div className={styles.sessionActions}>
                    {!status.connected ? (
                        <button
                            type="button"
                            className={`${styles.btn} ${styles.primary}`}
                            disabled={!robot.online || starting}
                            onClick={() => void handleStartSession()}
                        >
                            <IoPlayOutline size={18} />
                            <span>
                                {!robot.online
                                    ? 'Robot Offline'
                                    : starting
                                      ? 'Connecting to Robot…'
                                      : 'Start Manual Drive'}
                            </span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={`${styles.btn} ${styles.danger}`}
                            onClick={() => void handleStopSession()}
                        >
                            <IoStopOutline size={18} />
                            <span>End Session &amp; Stop</span>
                        </button>
                    )}
                </div>
            </header>

            {error && <div className={styles.errorBanner}>{error}</div>}
            {robotMessage && !error && (
                <div className={styles.infoBanner}>
                    <strong>Robot Telemetry:</strong> {String(robotMessage)}
                </div>
            )}

            <div className={styles.layout}>
                {/* Motion Pad */}
                <section className={styles.card}>
                    <h2>Directional Controls</h2>
                    <p className={styles.sub}>
                        Hold a pad button or press W / A / S / D / Q / E / Arrow keys to steer. Releasing stops immediately.
                    </p>

                    <div className={styles.dpadWrap}>
                        <div className={styles.dpadGrid}>
                            <button
                                type="button"
                                disabled={!status.connected}
                                className={`${styles.padBtn} ${activeCombo === 'arc-left' ? styles.active : ''}`}
                                {...bindPadPointer('arc-left')}
                            >
                                <IoArrowUndoOutline size={22} />
                                <span className={styles.padLabel}>Arc Left</span>
                                <kbd>Q</kbd>
                            </button>

                            <button
                                type="button"
                                disabled={!status.connected}
                                className={`${styles.padBtn} ${activeCombo === 'forward' ? styles.active : ''}`}
                                {...bindPadPointer('forward')}
                            >
                                <IoArrowUpOutline size={24} />
                                <span className={styles.padLabel}>Forward</span>
                                <kbd>W / ↑</kbd>
                            </button>

                            <button
                                type="button"
                                disabled={!status.connected}
                                className={`${styles.padBtn} ${activeCombo === 'arc-right' ? styles.active : ''}`}
                                {...bindPadPointer('arc-right')}
                            >
                                <IoArrowRedoOutline size={22} />
                                <span className={styles.padLabel}>Arc Right</span>
                                <kbd>E</kbd>
                            </button>

                            <button
                                type="button"
                                disabled={!status.connected}
                                className={`${styles.padBtn} ${activeCombo === 'pivot-left' ? styles.active : ''}`}
                                {...bindPadPointer('pivot-left')}
                            >
                                <IoArrowBackOutline size={22} />
                                <span className={styles.padLabel}>Pivot Left</span>
                                <kbd>A / ←</kbd>
                            </button>

                            <button
                                type="button"
                                disabled={!status.connected}
                                className={`${styles.padBtn} ${activeCombo === 'back' ? styles.active : ''}`}
                                {...bindPadPointer('back')}
                            >
                                <IoArrowDownOutline size={24} />
                                <span className={styles.padLabel}>Reverse</span>
                                <kbd>S / ↓</kbd>
                            </button>

                            <button
                                type="button"
                                disabled={!status.connected}
                                className={`${styles.padBtn} ${activeCombo === 'pivot-right' ? styles.active : ''}`}
                                {...bindPadPointer('pivot-right')}
                            >
                                <IoArrowForwardOutline size={22} />
                                <span className={styles.padLabel}>Pivot Right</span>
                                <kbd>D / →</kbd>
                            </button>
                        </div>

                        <button
                            type="button"
                            disabled={!status.connected}
                            className={styles.stopBar}
                            onClick={stopMotion}
                        >
                            <IoStopCircleOutline size={20} />
                            <span>Emergency Stop Motors</span>
                            <kbd>Space</kbd>
                        </button>
                    </div>
                </section>

                {/* Live Hardware Toggles */}
                <section className={styles.card}>
                    <h2>Live Hardware Actuators</h2>
                    <p className={styles.sub}>
                        Toggle suction, brush agitation, Eco/Turbo profile, or trigger a Spot Clean at the current position.
                    </p>

                    <div className={styles.hardwareList}>
                        <div className={styles.hwRow}>
                            <div className={styles.hwInfo}>
                                <strong>Vacuum Suction Motor</strong>
                                <span>Status: {status.vacuum_on ? 'Running' : 'Off'}</span>
                            </div>
                            <div className={styles.hwBtns}>
                                <button
                                    type="button"
                                    disabled={!status.connected}
                                    className={`${styles.btn} ${status.vacuum_on ? styles.primary : ''}`}
                                    onClick={() =>
                                        void sendCommand(status.vacuum_on ? 'vacuum-off' : 'vacuum-on')
                                    }
                                >
                                    {status.vacuum_on ? 'Turn Off' : 'Turn On'}
                                </button>
                            </div>
                        </div>

                        <div className={styles.hwRow}>
                            <div className={styles.hwInfo}>
                                <strong>Main Brush Roll</strong>
                                <span>Status: {status.brush_on ? 'Spinning' : 'Off'}</span>
                            </div>
                            <div className={styles.hwBtns}>
                                <button
                                    type="button"
                                    disabled={!status.connected}
                                    className={`${styles.btn} ${status.brush_on ? styles.primary : ''}`}
                                    onClick={() =>
                                        void sendCommand(status.brush_on ? 'brush-off' : 'brush-on')
                                    }
                                >
                                    {status.brush_on ? 'Turn Off' : 'Turn On'}
                                </button>
                            </div>
                        </div>

                        <div className={styles.hwRow}>
                            <div className={styles.hwInfo}>
                                <strong>Suction Profile</strong>
                                <span>Current: {status.eco_on ? 'Eco (Quiet)' : 'Turbo (Max)'}</span>
                            </div>
                            <div className={styles.hwBtns}>
                                <button
                                    type="button"
                                    disabled={!status.connected}
                                    className={`${styles.btn} ${status.eco_on ? styles.primary : ''}`}
                                    onClick={() => void sendCommand('eco-on')}
                                >
                                    Eco
                                </button>
                                <button
                                    type="button"
                                    disabled={!status.connected}
                                    className={`${styles.btn} ${status.connected && !status.eco_on ? styles.primary : ''}`}
                                    onClick={() => void sendCommand('turbo-on')}
                                >
                                    Turbo
                                </button>
                            </div>
                        </div>

                        <div className={styles.hwRow}>
                            <div className={styles.hwInfo}>
                                <strong>Spot Clean Here</strong>
                                <span>Ends manual drive and cleans a spot around the current position.</span>
                            </div>
                            <div className={styles.hwBtns}>
                                <button
                                    type="button"
                                    disabled={!status.connected}
                                    className={`${styles.btn} ${styles.primary}`}
                                    onClick={() => void sendCommand('clean-spot')}
                                >
                                    Clean Spot Here
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className={styles.safetyNote}>
                        <strong>LAN Requirement:</strong> The Vacuula server opens a direct WebSocket to the robot on your local network. Ensure the server can reach the robot’s LAN IP. If browser focus is lost or packets stop for 1.5 seconds, the server automatically halts wheel motors.
                    </div>
                </section>
            </div>
        </div>
    )
}
