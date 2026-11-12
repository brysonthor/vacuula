import styles from './RobotStateSvg.module.scss'

export type VisualRobotState =
    | 'offline'
    | 'cleaning'
    | 'docking'
    | 'docked'
    | 'idle'
    | 'paused'
    | 'error'
    | 'updating'
    | 'unknown'

export interface RobotStateSvgProps {
    connected: boolean
    stateLabel?: string | null
    hasError?: boolean
    isCharging?: boolean
    label: string
}

function normalizeVisualState(
    connected: boolean,
    stateLabel?: string | null,
    hasError?: boolean
): VisualRobotState {
    if (!connected) return 'offline'
    const normalized = (stateLabel || 'idle').toLowerCase()
    if (normalized === 'error' || (hasError && normalized === 'unknown')) return 'error'
    if (normalized === 'cleaning' || normalized === 'exploringmap') return 'cleaning'
    if (normalized === 'docking') return 'docking'
    if (normalized === 'docked' || normalized === 'cleaningstandby') return 'docked'
    if (normalized === 'paused' || normalized === 'suspendedexploration') return 'paused'
    if (
        normalized === 'updating' ||
        normalized === 'copyinglogs' ||
        normalized === 'acquiringpersistentmapids' ||
        normalized === 'creatinguploadingmap'
    ) {
        return 'updating'
    }
    if (normalized === 'idle' || normalized === 'recoveringlocation' || normalized === 'test') return 'idle'
    return 'unknown'
}

const stateClassMap: Record<VisualRobotState, string> = {
    cleaning: styles.stateCleaning,
    docked: styles.stateDocked,
    docking: styles.stateDocking,
    idle: styles.stateIdle,
    paused: styles.statePaused,
    error: styles.stateError,
    updating: styles.stateUpdating,
    offline: styles.stateOffline,
    unknown: styles.stateUnknown,
}

export default function RobotStateSvg({
    connected,
    stateLabel,
    hasError = false,
    isCharging = false,
    label,
}: RobotStateSvgProps) {
    const visualState = normalizeVisualState(connected, stateLabel, hasError)

    return (
        <span
            className={`${styles.root} ${stateClassMap[visualState]}`}
            role="img"
            aria-label={label}
            title={label}
            data-state={visualState}
        >
            <svg
                className={styles.svg}
                viewBox="0 0 36 26"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                {visualState === 'cleaning' && (
                    <g>
                        {/* Suction / motion trail */}
                        <circle cx="5" cy="10" r="1.4" fill="currentColor" className={styles.cleanTrail1} />
                        <circle cx="3.5" cy="16" r="1.1" fill="currentColor" className={styles.cleanTrail2} />
                        {/* D-shaped Neato robot gliding */}
                        <g className={styles.cleanGlide}>
                            <path
                                d="M12 5.5H20.5C24.9 5.5 28.5 8.85 28.5 13C28.5 17.15 24.9 20.5 20.5 20.5H12C10.9 20.5 10 19.6 10 18.5V7.5C10 6.4 10.9 5.5 12 5.5Z"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                fill="currentColor"
                                fillOpacity="0.14"
                            />
                            {/* Spinning LiDAR turret */}
                            <g className={`${styles.spinCenter} ${styles.cleanSpin}`}>
                                <circle cx="18.5" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.5" />
                                <line x1="18.5" y1="13" x2="21.4" y2="11.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </g>
                        </g>
                    </g>
                )}

                {visualState === 'docked' && (
                    <g>
                        {/* Charging dock base */}
                        <path
                            d="M28 6.5V19.5M28 8H30.5C31.05 8 31.5 8.45 31.5 9V17C31.5 17.55 31.05 18 30.5 18H28"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                        />
                        {/* Robot parked at dock */}
                        <path
                            d="M11 6.5H19.5C23.37 6.5 26.5 9.41 26.5 13C26.5 16.59 23.37 19.5 19.5 19.5H11C9.9 19.5 9 18.6 9 17.5V8.5C9 7.4 9.9 6.5 11 6.5Z"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            fill="currentColor"
                            fillOpacity="0.14"
                        />
                        {isCharging ? (
                            <path
                                d="M18.2 8.8L14.8 13.3H17.6L16.6 17.2L20.4 12.6H17.5L18.2 8.8Z"
                                fill="currentColor"
                                className={`${styles.pulseCenter} ${styles.chargeBolt}`}
                            />
                        ) : (
                            <circle
                                cx="17.5"
                                cy="13"
                                r="3"
                                fill="currentColor"
                                className={`${styles.pulseCenter} ${styles.calmBreath}`}
                            />
                        )}
                    </g>
                )}

                {visualState === 'docking' && (
                    <g>
                        {/* Guiding chevrons */}
                        <path
                            d="M5 10L8 13L5 16"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={styles.dockingChevron1}
                        />
                        <path
                            d="M9.5 10L12.5 13L9.5 16"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={styles.dockingChevron2}
                        />
                        {/* Robot approaching dock */}
                        <g className={styles.dockingBot}>
                            <path
                                d="M15.5 7H21C24.04 7 26.5 9.69 26.5 13C26.5 16.31 24.04 19 21 19H15.5C14.67 19 14 18.33 14 17.5V8.5C14 7.67 14.67 7 15.5 7Z"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                fill="currentColor"
                                fillOpacity="0.14"
                            />
                        </g>
                        {/* Dock target */}
                        <line x1="30.5" y1="6.5" x2="30.5" y2="19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </g>
                )}

                {visualState === 'idle' && (
                    <g>
                        <circle
                            cx="18"
                            cy="13"
                            r="8.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeOpacity="0.45"
                            className={`${styles.pulseCenter} ${styles.idleRadar}`}
                        />
                        <circle
                            cx="18"
                            cy="13"
                            r="4.2"
                            fill="currentColor"
                            className={`${styles.pulseCenter} ${styles.calmBreath}`}
                        />
                    </g>
                )}

                {visualState === 'paused' && (
                    <g className={`${styles.pulseCenter} ${styles.pausePulse}`}>
                        <circle
                            cx="18"
                            cy="13"
                            r="9"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            fill="currentColor"
                            fillOpacity="0.12"
                        />
                        <rect x="14.5" y="9" width="2.5" height="8" rx="1" fill="currentColor" />
                        <rect x="19" y="9" width="2.5" height="8" rx="1" fill="currentColor" />
                    </g>
                )}

                {visualState === 'error' && (
                    <g className={`${styles.pulseCenter} ${styles.errorPulse}`}>
                        <path
                            d="M18 4.5L27.2 20.5H8.8L18 4.5Z"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinejoin="round"
                            fill="currentColor"
                            fillOpacity="0.15"
                        />
                        <line x1="18" y1="10.2" x2="18" y2="15.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                        <circle cx="18" cy="17.8" r="1.1" fill="currentColor" />
                    </g>
                )}

                {visualState === 'updating' && (
                    <g className={`${styles.spinCenter} ${styles.updateSpin}`}>
                        <path
                            d="M18 5.5A7.5 7.5 0 0 1 25.1 10.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                        />
                        <path
                            d="M25.5 7.5V10.8H22.2"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <path
                            d="M18 20.5A7.5 7.5 0 0 1 10.9 15.5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                        />
                        <path
                            d="M10.5 18.5V15.2H13.8"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </g>
                )}

                {visualState === 'offline' && (
                    <g className={styles.offlineFade}>
                        {/* Disconnected signal arcs */}
                        <path
                            d="M11 10.5C14.87 7.17 21.13 7.17 25 10.5"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                        />
                        <path
                            d="M14 14C16.21 12.1 19.79 12.1 22 14"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                        />
                        <circle cx="18" cy="18" r="1.5" fill="currentColor" />
                        {/* Diagonal disconnect slash */}
                        <line
                            x1="10"
                            y1="20"
                            x2="26"
                            y2="6"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                        />
                    </g>
                )}

                {visualState === 'unknown' && (
                    <g>
                        <circle cx="12" cy="13" r="1.8" fill="currentColor" className={styles.dot1} />
                        <circle cx="18" cy="13" r="1.8" fill="currentColor" className={styles.dot2} />
                        <circle cx="24" cy="13" r="1.8" fill="currentColor" className={styles.dot3} />
                    </g>
                )}
            </svg>
        </span>
    )
}
