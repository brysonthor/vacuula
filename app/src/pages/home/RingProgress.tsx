import styles from './home.module.scss'

interface RingProgressProps {
    pct: number
    active?: boolean
    hasError?: boolean
    size?: number
}

export default function RingProgress({ pct, active = false, hasError = false, size = 188 }: RingProgressProps) {
    const stroke = 6
    const radius = (size - stroke * 2) / 2
    const circumference = 2 * Math.PI * radius
    const clamped = Math.max(0, Math.min(100, pct || 0))
    const dashOffset = circumference - (clamped / 100) * circumference

    const color = hasError
        ? 'var(--err)'
        : clamped <= 20
            ? 'var(--err)'
            : clamped <= 40
                ? 'var(--warn)'
                : 'var(--accent)'

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className={`${styles.ringSvg} ${active ? styles.ringActive : ''}`}
            aria-hidden="true"
        >
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--border)"
                strokeWidth={stroke}
            />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
            />
        </svg>
    )
}
