import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { FaDiscord, FaGithub } from 'react-icons/fa'
import { FaFileLines } from 'react-icons/fa6'
import { SiBuymeacoffee, SiKofi } from 'react-icons/si'
import { GrCertificate } from 'react-icons/gr'
import { VscFeedback } from 'react-icons/vsc'
import {
    IoColorPaletteOutline,
    IoEyeOffOutline,
    IoEyeOutline,
    IoHardwareChipOutline,
    IoNotificationsOutline,
    IoPaperPlaneOutline,
    IoSaveOutline,
    IoServerOutline,
    IoTerminalOutline,
} from 'react-icons/io5'
import Input from '../../components/input/input'
import Button from '../../components/button/button'
import { useApp } from '../../context/useApp'
import { BASE_PATH, Http } from '../../http'
import { APP_LANGUAGES, DEFAULT_LANGUAGE } from '../../i18n/languages'
import { ACCENTS, THEME_MODES, useTheme, type ThemeMode } from '../../theme'
import { UNITS, useUnits, type Units } from '../../units'
import { MASCOTS, useMascot } from '../../mascot'
import type { NotificationSettings } from '../../types'
import { loadSelectedMapShape, MAPSHAPES, saveSelectedMapShape } from './mapshapes'
import styles from './settings.module.scss'

function extractErrMsg(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const resp = (err as { response?: { data?: { message?: string } } }).response
        if (resp?.data?.message) return resp.data.message
    }
    return fallback
}

function formatUtcOffset(offsetMinutes: number): string {
    const sign = offsetMinutes >= 0 ? '+' : '-'
    const abs = Math.abs(offsetMinutes)
    const hours = String(Math.floor(abs / 60)).padStart(2, '0')
    const mins = String(abs % 60).padStart(2, '0')
    return `UTC${sign}${hours}:${mins}`
}

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
    discord_webhook_url: '',
    enabled: false,
    events: {
        connectivity: true,
        cleaning: true,
        errors: true,
        run_summary: true,
        consumables: true,
    },
}

const NOTIFICATION_CATEGORIES: Array<{
    key: keyof NotificationSettings['events']
    title: string
    desc: string
}> = [
    {
        key: 'connectivity',
        title: 'Robot Connectivity',
        desc: 'Alerts when a robot connects to or disconnects from the Vacuula server.',
    },
    {
        key: 'cleaning',
        title: 'Cleaning Transitions',
        desc: 'Notifications when cleaning runs start, pause, resume, or return to base.',
    },
    {
        key: 'errors',
        title: 'Errors & Stuck Alerts',
        desc: 'Immediate alerts when a robot encounters a brush jam, full bin, or navigation block.',
    },
    {
        key: 'run_summary',
        title: 'Completed Run Summaries',
        desc: 'Area cleaned, duration, and battery delta posted after each finished run.',
    },
    {
        key: 'consumables',
        title: 'Consumable Wear Warnings',
        desc: 'Reminders when filters, brushes, or sensors drop below 10% remaining lifespan.',
    },
]

export default function Settings() {
    const { t, i18n } = useTranslation()
    const navigate = useNavigate()
    const { serverInfo, robot } = useApp()
    const { theme, setTheme, accent, setAccent } = useTheme()
    const { units, setUnits } = useUnits()
    const { mascot, setMascot } = useMascot()

    const [selectedMapShape, setSelectedMapShape] = useState(loadSelectedMapShape())
    const [notifications, setNotifications] = useState<NotificationSettings>(DEFAULT_NOTIFICATIONS)
    const [showWebhook, setShowWebhook] = useState(false)
    const [savingNotifications, setSavingNotifications] = useState(false)
    const [testingNotifications, setTestingNotifications] = useState(false)
    const [notifFeedback, setNotifFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
        null
    )

    useEffect(() => {
        saveSelectedMapShape(selectedMapShape)
    }, [selectedMapShape])

    useEffect(() => {
        Http.getNotificationSettings()
            .then((res) => {
                setNotifications({
                    ...DEFAULT_NOTIFICATIONS,
                    ...res.data,
                    events: {
                        ...DEFAULT_NOTIFICATIONS.events,
                        ...(res.data.events ?? {}),
                    },
                })
            })
            .catch((err) => console.error('Failed to load notification settings', err))
    }, [])

    const handleSaveNotifications = async () => {
        setSavingNotifications(true)
        setNotifFeedback(null)
        try {
            const res = await Http.saveNotificationSettings(notifications)
            setNotifications(res.data)
            setNotifFeedback({ kind: 'ok', text: 'Notification settings saved.' })
        } catch (err: unknown) {
            setNotifFeedback({
                kind: 'error',
                text: extractErrMsg(err, 'Could not save notification settings.'),
            })
        } finally {
            setSavingNotifications(false)
        }
    }

    const handleTestNotification = async () => {
        setTestingNotifications(true)
        setNotifFeedback(null)
        try {
            const res = await Http.testNotificationSettings(notifications.discord_webhook_url)
            setNotifFeedback({
                kind: res.data.ok ? 'ok' : 'error',
                text: res.data.message || (res.data.ok ? 'Test message sent!' : 'Test failed.'),
            })
        } catch (err: unknown) {
            setNotifFeedback({
                kind: 'error',
                text: extractErrMsg(err, 'Failed to send test webhook.'),
            })
        } finally {
            setTestingNotifications(false)
        }
    }

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div className={styles.titleGroup}>
                    <h1>{t('settings.appSettings')} & Server</h1>
                    <p>Customize interface appearance, units, Discord webhook alerts, and server diagnostics.</p>
                </div>
                {robot && (
                    <button
                        type="button"
                        className={styles.btn}
                        onClick={() =>
                            navigate(`/robot/${encodeURIComponent(robot.serial)}/settings`)
                        }
                    >
                        <IoHardwareChipOutline size={17} />
                        <span>{robot.name} Settings</span>
                    </button>
                )}
            </header>

            <div className={styles.grid}>
                {/* 1. Appearance & Preferences */}
                <section className={styles.card}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2><IoColorPaletteOutline size={20} /> Appearance & Preferences</h2>
                            <p>Saved locally per browser across desktop and mobile sessions.</p>
                        </div>
                    </div>

                    <Input
                        type="select"
                        label={t('settings.theme')}
                        options={THEME_MODES.map((mode) => ({
                            value: mode,
                            label: t(`settings.theme_${mode}`),
                        }))}
                        value={theme}
                        onChange={(mode) => setTheme(mode as ThemeMode)}
                    />

                    <div className={styles.accentGroup}>
                        <span className={styles.accentLabel}>Accent Color</span>
                        <div className={styles.accentSwatches}>
                            {ACCENTS.map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    className={`${styles.swatchBtn} ${accent === opt.id ? styles.active : ''}`}
                                    onClick={() => setAccent(opt.id)}
                                >
                                    <span
                                        className={styles.swatchDot}
                                        style={{ backgroundColor: opt.preview }}
                                    />
                                    <span>{opt.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <Input
                        type="dropdown"
                        label={t('settings.appLanguage')}
                        options={APP_LANGUAGES.map((lang) => ({
                            value: lang.code,
                            label: lang.label,
                        }))}
                        value={i18n.resolvedLanguage ?? DEFAULT_LANGUAGE}
                        onChange={(code) => void i18n.changeLanguage(code)}
                    />

                    <Input
                        type="select"
                        label={t('settings.units')}
                        options={UNITS.map((u) => ({
                            value: u,
                            label: t(`settings.units_${u}`),
                        }))}
                        value={units}
                        onChange={(u) => setUnits(u as Units)}
                    />

                    <Input
                        type="select"
                        label={t('settings.mapShapeSelect')}
                        options={MAPSHAPES.map((shape) => ({
                            value: shape.value,
                            label: t(shape.label),
                        }))}
                        value={selectedMapShape}
                        onChange={setSelectedMapShape}
                    />

                    <Input
                        type="select"
                        label={t('settings.mascot')}
                        options={MASCOTS.map((m) => ({
                            value: m.id,
                            label: t(`settings.mascot_${m.id}`),
                        }))}
                        value={mascot.id}
                        onChange={(id) => setMascot(id)}
                    />
                </section>

                {/* 2. Discord Notifications */}
                <section className={styles.card}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2><IoNotificationsOutline size={20} /> Discord Webhook Notifications</h2>
                            <p>Receive real-time fleet events, error alerts, and run summaries in Discord.</p>
                        </div>
                    </div>

                    <div className={`${styles.toggleRow} ${styles.master}`}>
                        <div className={styles.toggleInfo}>
                            <strong>Enable Discord Notifications</strong>
                            <span>Master switch for all outgoing webhook alerts.</span>
                        </div>
                        <Input
                            type="switch"
                            skipSection={true}
                            value={notifications.enabled}
                            onChange={(enabled) =>
                                setNotifications((prev) => ({ ...prev, enabled }))
                            }
                        />
                    </div>

                    <div className={styles.webhookRow}>
                        <label htmlFor="discord-webhook-input">Discord Webhook URL</label>
                        <div className={styles.webhookInputWrap}>
                            <input
                                id="discord-webhook-input"
                                type={showWebhook ? 'text' : 'password'}
                                placeholder="https://discord.com/api/webhooks/..."
                                value={notifications.discord_webhook_url}
                                onChange={(e) =>
                                    setNotifications((prev) => ({
                                        ...prev,
                                        discord_webhook_url: e.target.value,
                                    }))
                                }
                            />
                            <button
                                type="button"
                                className={styles.btn}
                                onClick={() => setShowWebhook((v) => !v)}
                                aria-label={showWebhook ? 'Hide webhook URL' : 'Show webhook URL'}
                            >
                                {showWebhook ? <IoEyeOffOutline size={18} /> : <IoEyeOutline size={18} />}
                            </button>
                        </div>
                    </div>

                    <div className={styles.toggleList}>
                        {NOTIFICATION_CATEGORIES.map((cat) => (
                            <div key={cat.key} className={styles.toggleRow}>
                                <div className={styles.toggleInfo}>
                                    <strong>{cat.title}</strong>
                                    <span>{cat.desc}</span>
                                </div>
                                <Input
                                    type="switch"
                                    skipSection={true}
                                    value={Boolean(notifications.events[cat.key])}
                                    onChange={(checked) =>
                                        setNotifications((prev) => ({
                                            ...prev,
                                            events: {
                                                ...prev.events,
                                                [cat.key]: checked,
                                            },
                                        }))
                                    }
                                />
                            </div>
                        ))}
                    </div>

                    {notifFeedback && (
                        <div className={`${styles.feedbackBanner} ${styles[notifFeedback.kind]}`}>
                            {notifFeedback.text}
                        </div>
                    )}

                    <div className={styles.btnRow}>
                        <button
                            type="button"
                            className={`${styles.btn} ${styles.primary}`}
                            disabled={savingNotifications}
                            onClick={() => void handleSaveNotifications()}
                        >
                            <IoSaveOutline size={16} />
                            <span>{savingNotifications ? 'Saving…' : 'Save Notification Settings'}</span>
                        </button>
                        <button
                            type="button"
                            className={styles.btn}
                            disabled={testingNotifications || !notifications.discord_webhook_url.trim()}
                            onClick={() => void handleTestNotification()}
                        >
                            <IoPaperPlaneOutline size={16} />
                            <span>{testingNotifications ? 'Sending…' : 'Send Test'}</span>
                        </button>
                    </div>
                </section>

                {/* 3. Vacuula Server & Community */}
                <section className={`${styles.card} ${styles.cardFull}`}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2><IoServerOutline size={20} /> Vacuula Server & Community</h2>
                            <p>Server runtime diagnostics, SSL certificate download, logs, and community links.</p>
                        </div>
                    </div>

                    <div className={styles.serverMetaGrid}>
                        <div className={styles.metaItem}>
                            <span className={styles.mLabel}>Server Version</span>
                            <span className={styles.mValue}>v{serverInfo.version}</span>
                        </div>
                        <div className={styles.metaItem}>
                            <span className={styles.mLabel}>Min Installer</span>
                            <span className={styles.mValue}>v{serverInfo.min_installer_version}</span>
                        </div>
                        <div className={styles.metaItem}>
                            <span className={styles.mLabel}>Server Timezone</span>
                            <span className={styles.mValue}>
                                {serverInfo.timezone} ({formatUtcOffset(serverInfo.utc_offset_minutes)})
                            </span>
                        </div>
                        <div className={styles.metaItem}>
                            <span className={styles.mLabel}>Robot Ports</span>
                            <span className={styles.mValue}>
                                Gen 3: {serverInfo.gen3_port} • Gen 4: {serverInfo.gen4_port}
                            </span>
                        </div>
                    </div>

                    <div className={styles.vacuulaInfo}>
                        <Button
                            icon={<IoTerminalOutline size={20} />}
                            text="Live Server Logs"
                            style="primary"
                            onClick={() => navigate('/logs')}
                        />
                        <Button
                            icon={<FaFileLines size={18} />}
                            text={t('settings.downloadLogs')}
                            style="secondary"
                            onClick={() => window.open(`${BASE_PATH}/api/log/full?download=true`)}
                        />
                        <Button
                            icon={<GrCertificate size={18} />}
                            text={t('settings.downloadCert')}
                            style="secondary"
                            onClick={() => window.open(`${BASE_PATH}/api/cert`)}
                        />
                        <Button
                            icon={<VscFeedback size={18} />}
                            text={t('settings.giveFeedback')}
                            style="secondary"
                            onClick={() => window.open('https://feedback.vacuula.phma.dev/')}
                        />
                        <Button
                            icon={<FaGithub size={18} />}
                            text="GitHub"
                            style="secondary"
                            onClick={() => window.open('https://github.com/vacuula')}
                        />
                        <Button
                            icon={<FaDiscord size={18} />}
                            text="Discord"
                            style="secondary"
                            onClick={() => window.open('https://discord.gg/PAgwhWvyD8')}
                        />
                        <Button
                            icon={<SiKofi size={18} />}
                            text="Ko-fi"
                            style="secondary"
                            onClick={() => window.open('https://ko-fi.com/V7V61PBIY6')}
                        />
                        <Button
                            icon={<SiBuymeacoffee size={18} />}
                            text="Buy Me a Coffee"
                            style="secondary"
                            onClick={() => window.open('https://www.buymeacoffee.com/philip2809')}
                        />
                    </div>
                </section>
            </div>
        </div>
    )
}
