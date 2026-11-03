import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
    IoBuildOutline,
    IoCloudDownloadOutline,
    IoCloudUploadOutline,
    IoHardwareChipOutline,
    IoOptionsOutline,
    IoRefreshOutline,
    IoTrashOutline,
    IoWarningOutline,
} from 'react-icons/io5'
import Input from '../../components/input/input'
import Modal from '../../components/modal/Modal'
import { useRobot } from '../../context/useRobot'
import { useApp } from '../../context/useApp'
import { Http } from '../../http'
import { GEN3_COMMANDS } from '../../http/gen3'
import { GEN4_COMMANDS } from '../../http/gen4'
import {
    Neato,
    RobotType,
    type ConsumableItem,
    type RobotLogArchive,
    type RobotTelemetryResponse,
} from '../../types'
import type { UseState } from '../../components/map/types'
import styles from './RobotSettings.module.scss'

const CONSUMABLE_LABELS: Record<string, string> = {
    filter: 'High-Performance Filter',
    main_brush: 'Main Spiral Combo Brush',
    side_brush: 'Side Corner Brush',
    sensors: 'Drop & Laser Sensors',
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function manufacturingCodeToDate(code: string): Date | null {
    if (!/^[A-Z]{3}\d{5}$/.test(code)) return null
    const numeric = code.slice(3)
    const week = parseInt(numeric.slice(0, 2), 10)
    const dayOfWeek = parseInt(numeric.slice(2, 3), 10)
    const yearSuffix = parseInt(numeric.slice(3, 5), 10)
    if (week < 1 || week > 53 || dayOfWeek < 1 || dayOfWeek > 7) return null
    const year = 2000 + yearSuffix
    const jan1 = new Date(year, 0, 1)
    const week1Sunday = new Date(jan1)
    week1Sunday.setDate(jan1.getDate() - jan1.getDay())
    const offsetDays = (week - 1) * 7 + (dayOfWeek - 1)
    const result = new Date(week1Sunday)
    result.setDate(week1Sunday.getDate() + offsetDays)
    return result
}

export default function RobotSettings() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { robot, updateRobotName } = useRobot()
    const { refreshRobots } = useApp()

    const [nameDraft, setNameDraft] = useState<string | null>(null)
    const robotName = nameDraft ?? robot.name
    const [telemetry, setTelemetry] = useState<RobotTelemetryResponse | null>(null)
    const [loadingTelemetry, setLoadingTelemetry] = useState(false)
    const [consumables, setConsumables] = useState<ConsumableItem[]>([])
    const [editingConsumable, setEditingConsumable] = useState<ConsumableItem | null>(null)
    const [thresholdDraft, setThresholdDraft] = useState<string>('')

    const [logs, setLogs] = useState<RobotLogArchive[]>([])
    const [uploadingLogs, setUploadingLogs] = useState(false)

    const [confirmFactoryReset, setConfirmFactoryReset] = useState(false)
    const [resettingFactory, setResettingFactory] = useState(false)
    const [confirmDeleteRobot, setConfirmDeleteRobot] = useState(false)
    const [deletingRobot, setDeletingRobot] = useState(false)

    useEffect(() => {
        if (nameDraft === null) return
        const trimmed = nameDraft.trim()
        if (!trimmed || trimmed === robot.name) return
        const timer = setTimeout(() => {
            void updateRobotName(trimmed).then(() => setNameDraft(null))
        }, 500)
        return () => clearTimeout(timer)
    }, [nameDraft, robot.name, updateRobotName])

    const fetchTelemetry = useCallback(
        (refresh = false) =>
            Http.getRobotTelemetry(robot.serial, refresh && robot.online)
                .then((res) => setTelemetry(res.data))
                .catch((err) => console.error('Failed to load robot telemetry', err)),
        [robot.serial, robot.online]
    )

    const handleRefreshTelemetry = async () => {
        setLoadingTelemetry(true)
        await fetchTelemetry(true)
        setLoadingTelemetry(false)
    }

    const loadConsumables = useCallback(() => {
        Http.getConsumables(robot.serial)
            .then((res) => setConsumables(res.data))
            .catch((err) => console.error('Failed to load consumables', err))
    }, [robot.serial])

    const loadRobotLogs = useCallback(() => {
        if (robot.type !== RobotType.NeatoGen3) return
        Http.getRobotLogs(robot.serial)
            .then((res) => setLogs(res.data))
            .catch((err) => console.error('Failed to load robot logs', err))
    }, [robot.serial, robot.type])

    useEffect(() => {
        void fetchTelemetry(robot.online)
        loadConsumables()
        loadRobotLogs()
    }, [fetchTelemetry, loadConsumables, loadRobotLogs, robot.online])

    const handleResetConsumable = async (item: ConsumableItem) => {
        try {
            const res = await Http.resetConsumable(robot.serial, item.consumable)
            setConsumables(res.data)
        } catch (err) {
            console.error('Failed to reset consumable', err)
        }
    }

    const handleSaveThreshold = async () => {
        if (!editingConsumable) return
        const hours = Number(thresholdDraft)
        if (!Number.isFinite(hours) || hours <= 0) return
        try {
            const res = await Http.updateConsumableThreshold(
                robot.serial,
                editingConsumable.consumable,
                hours
            )
            setConsumables(res.data)
            setEditingConsumable(null)
        } catch (err) {
            console.error('Failed to update consumable threshold', err)
        }
    }

    const handleUploadGen3Logs = async () => {
        if (!robot.online || uploadingLogs) return
        setUploadingLogs(true)
        try {
            await GEN3_COMMANDS.uploadLogs(robot.serial, 1)
            for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise((r) => setTimeout(r, 1500))
                try {
                    const st = await GEN3_COMMANDS.getLogsUploadState(robot.serial)
                    const payload = st.data as { data?: { status?: string } }
                    const statusStr = String(payload?.data?.status ?? '')
                    if (statusStr && statusStr !== 'uploading' && statusStr !== 'copying') {
                        break
                    }
                } catch {
                    break
                }
            }
            loadRobotLogs()
        } catch (err) {
            console.error('Failed to trigger Gen 3 log upload', err)
        } finally {
            setUploadingLogs(false)
        }
    }

    const handleFactoryReset = async () => {
        if (!robot.online || resettingFactory) return
        setResettingFactory(true)
        try {
            await GEN4_COMMANDS.factoryReset(robot.serial)
            setConfirmFactoryReset(false)
        } catch (err) {
            console.error('Factory reset failed', err)
        } finally {
            setResettingFactory(false)
        }
    }

    const handleDeleteRobot = async () => {
        if (deletingRobot) return
        setDeletingRobot(true)
        try {
            await Http.deleteRobot(robot.serial)
            setConfirmDeleteRobot(false)
            await refreshRobots()
            navigate('/')
        } catch (err) {
            console.error('Delete robot failed', err)
            setDeletingRobot(false)
        }
    }

    const displaySerial = 'label_serial' in robot ? robot.label_serial : robot.serial
    const birthday =
        robot.type === RobotType.NeatoGen3
            ? manufacturingCodeToDate(robot.serial.split('-')[0])
            : null
    const batteryInfo = telemetry?.info?.battery

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div className={styles.titleGroup}>
                    <h1>{t('settings.robotSettings')} — {robot.name}</h1>
                    <p>Hardware diagnostics, consumable lifespan tracking, onboard preferences, and maintenance.</p>
                </div>
                <span className={`${styles.statusPill} ${robot.online ? styles.online : styles.offline}`}>
                    {robot.online ? 'Online & Connected' : 'Offline (Read-Only Telemetry)'}
                </span>
            </header>

            <div className={styles.grid}>
                {/* 1. Identity & Hardware Telemetry */}
                <section className={styles.card}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2><IoHardwareChipOutline size={20} /> Identity & Hardware Telemetry</h2>
                            <p>Persisted hardware metadata and live robot diagnostics.</p>
                        </div>
                        {robot.online && (
                            <button
                                type="button"
                                className={styles.actionBtn}
                                disabled={loadingTelemetry}
                                onClick={() => void handleRefreshTelemetry()}
                            >
                                <IoRefreshOutline size={16} />
                                <span>{loadingTelemetry ? 'Refreshing…' : 'Refresh'}</span>
                            </button>
                        )}
                    </div>

                    <Input
                        type="text"
                        label={t('common.name')}
                        value={robotName}
                        onChange={setNameDraft}
                    />

                    <div className={styles.telemetryGrid}>
                        <div className={styles.telemetryItem}>
                            <span className={styles.tLabel}>Serial</span>
                            <span className={styles.tValue}>{displaySerial}</span>
                        </div>
                        <div className={styles.telemetryItem}>
                            <span className={styles.tLabel}>Generation</span>
                            <span className={styles.tValue}>
                                {robot.type === RobotType.NeatoGen4 ? 'Neato Gen 4 (Orbital)' : 'Neato Gen 3 (Nucleo)'}
                            </span>
                        </div>
                        <div className={styles.telemetryItem}>
                            <span className={styles.tLabel}>Model</span>
                            <span className={styles.tValue}>
                                {telemetry?.model || telemetry?.info?.model || t('common.notAvailable')}
                            </span>
                        </div>
                        <div className={styles.telemetryItem}>
                            <span className={styles.tLabel}>Firmware</span>
                            <span className={styles.tValue}>
                                {telemetry?.firmware || telemetry?.info?.firmware || t('common.notAvailable')}
                            </span>
                        </div>
                        <div className={styles.telemetryItem}>
                            <span className={styles.tLabel}>LAN IP</span>
                            <span className={styles.tValue}>
                                {telemetry?.ip_address || t('common.notAvailable')}
                            </span>
                        </div>
                        <div className={styles.telemetryItem}>
                            <span className={styles.tLabel}>Last Seen</span>
                            <span className={styles.tValue}>
                                {telemetry?.last_seen_at
                                    ? new Date(telemetry.last_seen_at).toLocaleString()
                                    : robot.online
                                      ? 'Connected'
                                      : t('common.notAvailable')}
                            </span>
                        </div>
                        {birthday && (
                            <div className={styles.telemetryItem}>
                                <span className={styles.tLabel}>Manufactured</span>
                                <span className={styles.tValue}>{birthday.toLocaleDateString()}</span>
                            </div>
                        )}
                        {batteryInfo?.totalCharges !== undefined && (
                            <div className={styles.telemetryItem}>
                                <span className={styles.tLabel}>Battery Cycles</span>
                                <span className={styles.tValue}>{batteryInfo.totalCharges}</span>
                            </div>
                        )}
                        {batteryInfo?.vendor && (
                            <div className={styles.telemetryItem}>
                                <span className={styles.tLabel}>Battery Vendor</span>
                                <span className={styles.tValue}>{batteryInfo.vendor}</span>
                            </div>
                        )}
                        {batteryInfo?.timeToEmpty !== undefined && batteryInfo.timeToEmpty > 0 && (
                            <div className={styles.telemetryItem}>
                                <span className={styles.tLabel}>Est. Time to Empty</span>
                                <span className={styles.tValue}>{batteryInfo.timeToEmpty} min</span>
                            </div>
                        )}
                        {batteryInfo?.timeToFullCharge !== undefined && batteryInfo.timeToFullCharge > 0 && (
                            <div className={styles.telemetryItem}>
                                <span className={styles.tLabel}>Time to Full Charge</span>
                                <span className={styles.tValue}>{batteryInfo.timeToFullCharge} min</span>
                            </div>
                        )}
                    </div>
                </section>

                {/* 2. Onboard Robot Preferences */}
                <section className={styles.card}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2><IoOptionsOutline size={20} /> Onboard Robot Preferences</h2>
                            <p>Firmware-stored audio, language, floorplan, and onboard alert intervals.</p>
                        </div>
                    </div>

                    {!robot.online ? (
                        <div className={styles.offlineNotice}>
                            This robot is currently offline. Onboard firmware settings will become editable automatically as soon as the robot reconnects.
                        </div>
                    ) : robot.type === RobotType.NeatoGen4 ? (
                        <Gen4PreferencesSection serial={robot.serial} />
                    ) : (
                        <Gen3PreferencesSection serial={robot.serial} />
                    )}
                </section>

                {/* 3. Consumables & Maintenance */}
                <section className={`${styles.card} ${styles.cardFull}`}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2><IoBuildOutline size={20} /> Consumables & Maintenance Lifespan</h2>
                            <p>Computed automatically from recorded cleaning runtime since each component was last replaced or cleaned.</p>
                        </div>
                    </div>

                    <div className={styles.consumableGrid}>
                        {consumables.map((item) => {
                            const pct = Math.max(0, Math.min(100, Math.round(item.percent_remaining)))
                            const healthClass =
                                pct <= 15 ? styles.low : pct <= 35 ? styles.medium : styles.good
                            const label = CONSUMABLE_LABELS[item.consumable] || item.consumable

                            return (
                                <div
                                    key={item.consumable}
                                    className={`${styles.consumableCard} ${item.needs_attention ? styles.worn : ''}`}
                                >
                                    <div className={styles.consumableTop}>
                                        <span className={styles.cName}>{label}</span>
                                        <span className={styles.cPct}>{pct}%</span>
                                    </div>
                                    <div className={styles.barTrack}>
                                        <div
                                            className={`${styles.barFill} ${healthClass}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <div className={styles.consumableMeta}>
                                        <span>{item.remaining_hours.toFixed(1)}h left of {item.threshold_hours}h</span>
                                        <span>{item.used_hours.toFixed(1)}h used</span>
                                    </div>
                                    <div className={styles.consumableMeta}>
                                        <span>
                                            Last reset:{' '}
                                            {item.reset_at
                                                ? new Date(item.reset_at).toLocaleDateString()
                                                : 'Baseline (all runs)'}
                                        </span>
                                    </div>
                                    <div className={styles.consumableActions}>
                                        <button
                                            type="button"
                                            className={`${styles.actionBtn} ${styles.primary}`}
                                            onClick={() => void handleResetConsumable(item)}
                                        >
                                            Mark Replaced / Cleaned
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.actionBtn}
                                            onClick={() => {
                                                setEditingConsumable(item)
                                                setThresholdDraft(String(item.threshold_hours))
                                            }}
                                        >
                                            Target ({item.threshold_hours}h)
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </section>

                {/* 4. Gen 3 Diagnostic Logs */}
                {robot.type === RobotType.NeatoGen3 && (
                    <section className={`${styles.card} ${styles.cardFull}`}>
                        <div className={styles.cardHeader}>
                            <div>
                                <h2><IoCloudDownloadOutline size={20} /> Diagnostic Log Archives (Gen 3)</h2>
                                <p>Pull internal diagnostic tarballs from the robot onto the Vacuula server and download them locally.</p>
                            </div>
                            <div className={styles.logsToolbar}>
                                <button
                                    type="button"
                                    className={`${styles.actionBtn} ${styles.primary}`}
                                    disabled={!robot.online || uploadingLogs}
                                    onClick={() => void handleUploadGen3Logs()}
                                >
                                    <IoCloudUploadOutline size={16} />
                                    <span>{uploadingLogs ? 'Uploading from Robot…' : 'Pull Logs from Robot'}</span>
                                </button>
                                <button
                                    type="button"
                                    className={styles.actionBtn}
                                    onClick={() => void loadRobotLogs()}
                                >
                                    <IoRefreshOutline size={16} />
                                    <span>Refresh List</span>
                                </button>
                            </div>
                        </div>

                        {logs.length === 0 ? (
                            <p className={styles.emptyText}>
                                No diagnostic archives uploaded for this robot yet. Click “Pull Logs from Robot” while online to capture one.
                            </p>
                        ) : (
                            <div className={styles.logsList}>
                                {logs.map((archive) => (
                                    <div key={`${archive.job_id}/${archive.filename}`} className={styles.logRow}>
                                        <div className={styles.logMeta}>
                                            <span className={styles.logName}>{archive.filename}</span>
                                            <span className={styles.logSub}>
                                                {formatBytes(archive.size_bytes)} •{' '}
                                                {new Date(archive.uploaded_at * 1000).toLocaleString()} • Job {archive.job_id}
                                            </span>
                                        </div>
                                        <a
                                            className={styles.actionBtn}
                                            href={Http.getRobotLogDownloadUrl(
                                                robot.serial,
                                                archive.job_id,
                                                archive.filename
                                            )}
                                            download={archive.filename}
                                        >
                                            <IoCloudDownloadOutline size={16} />
                                            <span>Download .tar.gz</span>
                                        </a>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {/* 5. Danger Zone */}
                <section className={`${styles.card} ${styles.cardFull} ${styles.dangerCard}`}>
                    <div className={styles.cardHeader}>
                        <div>
                            <h2><IoWarningOutline size={20} /> Danger Zone</h2>
                            <p>Irreversible robot and server cleanup actions.</p>
                        </div>
                    </div>

                    <div className={styles.dangerList}>
                        {robot.type === RobotType.NeatoGen4 && (
                            <div className={styles.dangerRow}>
                                <div className={styles.dangerText}>
                                    <strong>{t('settings.factoryReset')}</strong>
                                    <span>{t('settings.factoryResetInfo')}</span>
                                </div>
                                <button
                                    type="button"
                                    className={`${styles.actionBtn} ${styles.danger}`}
                                    disabled={!robot.online}
                                    onClick={() => setConfirmFactoryReset(true)}
                                >
                                    Factory Reset Robot
                                </button>
                            </div>
                        )}

                        <div className={styles.dangerRow}>
                            <div className={styles.dangerText}>
                                <strong>Remove Robot from Vacuula Server</strong>
                                <span>
                                    Deletes stored run history, floorplan snapshots, server schedules, and telemetry for {robot.name} ({displaySerial}) from Vacuula. If the robot is still powered on and pointed at this server, it will re-register on next connect.
                                </span>
                            </div>
                            <button
                                type="button"
                                className={`${styles.actionBtn} ${styles.danger}`}
                                onClick={() => setConfirmDeleteRobot(true)}
                            >
                                <IoTrashOutline size={16} />
                                <span>Remove Robot</span>
                            </button>
                        </div>
                    </div>
                </section>
            </div>

            {/* Threshold Modal */}
            <Modal
                open={Boolean(editingConsumable)}
                onClose={() => setEditingConsumable(null)}
                title={
                    editingConsumable
                        ? `Target Lifespan — ${CONSUMABLE_LABELS[editingConsumable.consumable] || editingConsumable.consumable}`
                        : 'Target Lifespan'
                }
                footer={
                    <div className={styles.modalActions}>
                        <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => setEditingConsumable(null)}
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.primary}`}
                            onClick={() => void handleSaveThreshold()}
                        >
                            {t('common.save')}
                        </button>
                    </div>
                }
            >
                <div className={styles.modalForm}>
                    <p>Set the recommended runtime hours before Vacuula flags this part for maintenance or sends a notification.</p>
                    <input
                        type="number"
                        min={1}
                        max={2000}
                        step={5}
                        value={thresholdDraft}
                        onChange={(e) => setThresholdDraft(e.target.value)}
                    />
                </div>
            </Modal>

            {/* Factory Reset Modal */}
            <Modal
                open={confirmFactoryReset}
                onClose={() => setConfirmFactoryReset(false)}
                title={t('settings.factoryReset')}
                footer={
                    <div className={styles.modalActions}>
                        <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => setConfirmFactoryReset(false)}
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.danger}`}
                            disabled={resettingFactory}
                            onClick={() => void handleFactoryReset()}
                        >
                            {resettingFactory ? t('settings.resetting') : 'Confirm Factory Reset'}
                        </button>
                    </div>
                }
            >
                <div className={styles.modalForm}>
                    <p>
                        Are you sure you want to factory reset <strong>{robot.name}</strong>? This wipes onboard Wi-Fi credentials, maps, and settings stored on the robot itself.
                    </p>
                </div>
            </Modal>

            {/* Delete Robot Modal */}
            <Modal
                open={confirmDeleteRobot}
                onClose={() => setConfirmDeleteRobot(false)}
                title={`Remove ${robot.name} from Vacuula?`}
                footer={
                    <div className={styles.modalActions}>
                        <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => setConfirmDeleteRobot(false)}
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.danger}`}
                            disabled={deletingRobot}
                            onClick={() => void handleDeleteRobot()}
                        >
                            {deletingRobot ? 'Removing…' : 'Remove Permanently'}
                        </button>
                    </div>
                }
            >
                <div className={styles.modalForm}>
                    <p>
                        This permanently deletes <strong>{robot.name}</strong> ({displaySerial}), all saved maps, cleaning run history, and server schedules from the Vacuula database.
                    </p>
                </div>
            </Modal>
        </div>
    )
}

function Gen4PreferencesSection({ serial }: { serial: string }) {
    const { t } = useTranslation()
    const [cleaningOptions, setCleaningOptions] = useState<Neato.Gen4.SettingsCleaningOptions>()
    const [robotLanguage, setRobotLanguage] = useState<Neato.Gen4.SettingsRobotLanguage>()

    const getCleaningOptions = useCallback(
        () =>
            GEN4_COMMANDS.getSettings(serial, {
                operation: Neato.Gen4.SettingsCleaningOptionsOperation.GET,
            }).then((d) => setCleaningOptions(d.data.body)),
        [serial]
    )

    const getRobotLanguage = useCallback(
        () =>
            GEN4_COMMANDS.getSettings(serial, {
                operation: Neato.Gen4.SettingsRobotLanguageOperation.GET,
            }).then((d) => setRobotLanguage(d.data.body)),
        [serial]
    )

    useEffect(() => {
        void getCleaningOptions()
        void getRobotLanguage()
    }, [getCleaningOptions, getRobotLanguage])

    if (!cleaningOptions || !robotLanguage) {
        return <p className={styles.emptyText}>{t('common.loading')}…</p>
    }

    return (
        <>
            <div className={styles.switchRow}>
                <span className={styles.switchTitle}>{t('settings.forceFloorplan')}</span>
                <Input
                    type="switch"
                    skipSection={true}
                    value={cleaningOptions.force_floorplan}
                    onChange={(force_floorplan) => {
                        const updated = { ...cleaningOptions, force_floorplan }
                        setCleaningOptions(updated)
                        GEN4_COMMANDS.setSettings(serial, {
                            operation: Neato.Gen4.SettingsCleaningOptionsOperation.SET,
                            values: updated,
                        }).finally(() => void getCleaningOptions())
                    }}
                />
            </div>

            <Input
                type="dropdown"
                label={t('settings.robotLanguage')}
                options={robotLanguage.available_languages.map((lang) => ({ value: lang, label: lang }))}
                value={robotLanguage.language}
                onChange={(language) => {
                    const updated = { ...robotLanguage, language }
                    setRobotLanguage(updated)
                    GEN4_COMMANDS.setSettings(serial, {
                        operation: Neato.Gen4.SettingsRobotLanguageOperation.SET,
                        values: updated,
                    }).finally(() => void getRobotLanguage())
                }}
            />
        </>
    )
}

function Gen3PreferencesSection({ serial }: { serial: string }) {
    const { t } = useTranslation()
    const [preferences, setPreferences] = useState<Neato.Gen3.Preferences | undefined>(undefined)
    const isInitialLoad = useRef(true)

    useEffect(() => {
        isInitialLoad.current = true
        GEN3_COMMANDS.getPreferences(serial).then((res) => {
            setPreferences(res.data.data)
        })
    }, [serial])

    useEffect(() => {
        if (!preferences) return
        if (isInitialLoad.current) {
            isInitialLoad.current = false
            return
        }
        void GEN3_COMMANDS.setPreferences(serial, preferences)
    }, [preferences, serial])

    const updateForm = <T,>(update: UseState<T>, patch: Partial<T>) => {
        update((prev) => ({
            ...prev,
            ...patch,
        }))
    }

    if (!preferences) {
        return <p className={styles.emptyText}>{t('common.loading')}…</p>
    }

    return (
        <>
            <div className={styles.switchRow}>
                <span className={styles.switchTitle}>{t('settings.robotSounds')}</span>
                <Input
                    type="switch"
                    skipSection={true}
                    value={preferences.robotSounds}
                    onChange={(robotSounds) => updateForm(setPreferences, { robotSounds })}
                />
            </div>

            <Input
                type="select"
                label={t('settings.binReminder')}
                options={[30, 60, 90, 120, 150].map((i) => ({ value: i, label: `${i}m` }))}
                value={preferences.dirtbinAlertReminderInterval}
                onChange={(dirtbinAlertReminderInterval) =>
                    updateForm(setPreferences, { dirtbinAlertReminderInterval })
                }
            />

            <Input
                type="select"
                label={t('settings.filterReminder')}
                options={[1, 1.5, 2, 2.5, 3].map((i) => ({
                    value: i * 30 * 24 * 60,
                    label: `${i} mo`,
                }))}
                value={preferences.filterChangeReminderInterval}
                onChange={(filterChangeReminderInterval) =>
                    updateForm(setPreferences, { filterChangeReminderInterval })
                }
            />

            <Input
                type="select"
                label={t('settings.brushReminder')}
                options={[4, 5, 6, 7, 8].map((i) => ({
                    value: i * 30 * 24 * 60,
                    label: `${i} mo`,
                }))}
                value={preferences.brushChangeReminderInterval}
                onChange={(brushChangeReminderInterval) =>
                    updateForm(setPreferences, { brushChangeReminderInterval })
                }
            />
        </>
    )
}
