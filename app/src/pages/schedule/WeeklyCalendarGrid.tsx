import { useTranslation } from 'react-i18next'
import styles from './schedule.module.scss'

export interface CalendarSlot {
    id: string
    dayCode: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
    time: string
    label: string
    subLabel?: string
    source: 'firmware' | 'server'
    enabled: boolean
    onClick?: () => void
}

const WEEK_ORDER: Array<{ code: CalendarSlot['dayCode']; key: string; fallback: string }> = [
    { code: 'mon', key: 'days.monday', fallback: 'Mon' },
    { code: 'tue', key: 'days.tuesday', fallback: 'Tue' },
    { code: 'wed', key: 'days.wednesday', fallback: 'Wed' },
    { code: 'thu', key: 'days.thursday', fallback: 'Thu' },
    { code: 'fri', key: 'days.friday', fallback: 'Fri' },
    { code: 'sat', key: 'days.saturday', fallback: 'Sat' },
    { code: 'sun', key: 'days.sunday', fallback: 'Sun' },
]

export default function WeeklyCalendarGrid({ slots }: { slots: CalendarSlot[] }) {
    const { t } = useTranslation()

    return (
        <div className={styles.calendarCard}>
            <div className={styles.calendarGrid}>
                {WEEK_ORDER.map(day => {
                    const daySlots = slots
                        .filter(s => s.dayCode === day.code)
                        .sort((a, b) => a.time.localeCompare(b.time))

                    return (
                        <div key={day.code} className={styles.dayColumn}>
                            <div className={styles.dayHeader}>
                                {t(day.key as any, day.fallback).slice(0, 3)}
                            </div>
                            <div className={styles.dayBody}>
                                {daySlots.length === 0 ? (
                                    <span className={styles.emptySlotDash}>—</span>
                                ) : (
                                    daySlots.map(slot => (
                                        <button
                                            key={slot.id}
                                            type="button"
                                            onClick={slot.onClick}
                                            className={`${styles.calChip} ${
                                                slot.source === 'server' ? styles.calChipServer : ''
                                            } ${!slot.enabled ? styles.calChipDisabled : ''}`}
                                        >
                                            <span className={styles.calTime}>{slot.time}</span>
                                            <span className={styles.calLabel}>{slot.label}</span>
                                            {slot.subLabel && (
                                                <span className={styles.calSub}>{slot.subLabel}</span>
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
