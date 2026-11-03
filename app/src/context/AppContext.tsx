import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BASE_PATH, Http, type LoadingState, type ServerInfo } from '../http'
import { GEN3_COMMANDS } from '../http/gen3'
import type { UseState } from '../components/map/types'
import { Neato, RobotType, type QuickRobotEntry, type QuickRobotInfo, type Robot, type ZoneQueueState } from '../types'
import { GEN4_COMMANDS } from '../http/gen4'
import { OrbitalServices, type AnyEvent } from '../types/neato/gen4'
import { persistentMapsLoader } from '../loaders/resources'
import { useTheme } from '../theme'
import Loading from '../pages/loading/loading'
import { ServerHasOutdatedRobot, ServerUnreachable } from '../components/require/emptyState'
import { isRobotOutdated } from '../utils/version'

interface AppContextType {
    serverInfo: ServerInfo
    robot?: Robot
    robots?: QuickRobotInfo
    selectRobot: (serial: string) => void
    refreshRobots: () => Promise<void>
    updateRobotName: (name: string) => Promise<void>
    lastHeartbeat?: number

    zoneQueues: Record<string, ZoneQueueState | null>
    refreshZoneQueue: (serial: string) => void

    persistentMaps?: (Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[])
    setPersistentMaps?: UseState<(Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[]) | undefined>

    cleanings?: Neato.Gen4.Cleaning[] | Neato.Gen3.CleaningRun[]
    setCleanings: UseState<Neato.Gen4.Cleaning[] | Neato.Gen3.CleaningRun[] | undefined>

    isDarkMode: boolean
    setIsDarkMode: (dark: boolean) => void

    isLoading: boolean
    setIsLoading: (loading: boolean) => void
    loadingState: LoadingState
    setLoadingState: (state: LoadingState) => void

    message: string | null
    setMessage: (msg: string | null) => void

    getGen3State: (serial: string, name: string) => void
}

function buildOfflineRobot(serial: string, entry: QuickRobotEntry, rawLastState?: any): Robot {
    if (entry.type === RobotType.NeatoGen3) {
        const s = rawLastState?.data ?? rawLastState ?? {}
        return {
            type: RobotType.NeatoGen3,
            serial,
            name: entry.name,
            online: false,
            availableCommands: {
                start: false,
                stop: false,
                pause: false,
                resume: false,
                goToBase: false,
            },
            availableServices: s.availableServices,
            cleaning: s.cleaning,
            meta: s.meta ?? (entry.model || entry.firmware ? {
                modelName: (entry.model ?? 'BotVacD7Connected') as any,
                firmware: entry.firmware ?? '',
            } : undefined),
            details: s.details ?? {
                isCharging: !!entry.is_charging,
                isDocked: !!entry.is_docked,
                dockHasBeenSeen: false,
                charge: entry.charge ?? 0,
                isScheduleEnabled: false,
            },
            alert: s.alert,
            error: s.error,
            state: s.state ?? Neato.Gen3.RobotState.IDLE,
            action: s.action ?? Neato.Gen3.RobotAction.INVALID,
        }
    }

    const s = rawLastState?.body ?? rawLastState ?? {}
    return {
        type: RobotType.NeatoGen4,
        serial,
        name: entry.name,
        online: false,
        label_serial: entry.label_serial ?? serial,
        availableCommands: {
            start: false,
            cancel: false,
            pause: false,
            resume: false,
            return_to_base: false,
        },
        details: s.details ?? {
            is_charging: !!entry.is_charging,
            is_docked: !!entry.is_docked,
            charge: entry.charge ?? 0,
            base_type: 'standard',
            is_quickboost: false,
            quickboost_estimate: 0,
        },
        errors: s.errors ?? undefined,
        state: s.state ?? Neato.Gen4.RobotState.IDLE,
        action: s.action ?? Neato.Gen4.RobotAction.INVALID,
    }
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
    const [robot, setRobot] = useState<Robot>()
    const [robots, setRobots] = useState<QuickRobotInfo>()
    const [lastHeartbeat, setLastHeartbeat] = useState<number | undefined>()
    const [zoneQueues, setZoneQueues] = useState<Record<string, ZoneQueueState | null>>({})
    const [cleanings, setCleanings] = useState<Neato.Gen4.Cleaning[] | Neato.Gen3.CleaningRun[]>()
    const { isDark: isDarkMode, setTheme } = useTheme()
    const setIsDarkMode = (dark: boolean) => setTheme(dark ? 'dark' : 'light')
    const [isLoading, setIsLoading] = useState(false)
    const [loadingState, setLoadingState] = useState<LoadingState>({ isLoading: false })
    const [message, setMessage] = useState<string | null>(null)
    const [hasOutdatedRobot, setHasOutdatedRobot] = useState(false)
    const [serverInfo, setServerInfo] = useState<ServerInfo>()
    const [serverInfoError, setServerInfoError] = useState(false)

    const robotRef = useRef<Robot | undefined>(undefined)
    robotRef.current = robot
    const robotsRef = useRef<QuickRobotInfo | undefined>(undefined)
    robotsRef.current = robots

    useEffect(() => {
        Http.setLoadingStateCallback(setLoadingState)
    }, [])

    useEffect(() => {
        if (!robots || !serverInfo) return
        const hasOutdated = Object.values(robots).some(
            r => r?.connected && r.installed_with && isRobotOutdated(r.installed_with, serverInfo.min_installer_version)
        )
        setHasOutdatedRobot(hasOutdated)
    }, [robots, serverInfo])

    const loadServerInfo = () => {
        setServerInfoError(false)
        Http.getServerInfo()
            .then(res => setServerInfo(res.data))
            .catch(err => {
                console.error('Failed to fetch server info', err)
                setServerInfoError(true)
            })
    }

    useEffect(() => { loadServerInfo() }, [])

    const refreshZoneQueue = useCallback((serial: string) => {
        if (!serial.includes('-')) return
        Http.getZoneQueue(serial)
            .then(res => {
                setZoneQueues(cur => ({ ...cur, [serial]: res.data.queue }))
            })
            .catch(() => {})
    }, [])

    const getGen3State = useCallback((serial: string, name: string) => {
        GEN3_COMMANDS.getRobotState(serial)
            .then((res) => {
                setRobot({
                    type: RobotType.NeatoGen3,
                    serial,
                    name,
                    online: true,
                    availableCommands: res.data.availableCommands,
                    availableServices: res.data.availableServices,
                    cleaning: res.data.cleaning,
                    meta: res.data.meta,
                    details: res.data.details,
                    alert: res.data.alert,
                    error: res.data.error,
                    state: res.data.state,
                    action: res.data.action,
                })
            })
            .catch((err) => {
                console.warn('getGen3State failed, falling back to cached state:', err)
                const entry = robotsRef.current?.[serial]
                if (entry) setRobot(buildOfflineRobot(serial, entry, entry.last_state))
            })
    }, [])

    const connectToRobot = useCallback((robotsInfo: QuickRobotInfo, serial: string, entry: QuickRobotEntry) => {
        if (!entry.connected) {
            setRobot(buildOfflineRobot(serial, entry, entry.last_state))
            Http.getRobotTelemetry(serial, false)
                .then(res => {
                    if (res.data?.last_state && Object.keys(res.data.last_state).length > 0) {
                        setRobot(cur => (cur && cur.serial === serial && !cur.online)
                            ? buildOfflineRobot(serial, entry, res.data.last_state)
                            : cur
                        )
                    }
                })
                .catch(() => {})
            return
        }

        if (entry.type === RobotType.NeatoGen3) {
            getGen3State(serial, entry.name)
            refreshZoneQueue(serial)
        } else if (entry.type === RobotType.NeatoGen4) {
            GEN4_COMMANDS.getRobotState(serial)
                .then((res) => {
                    const body = res.data.body
                    const label_serial = robotsInfo[serial]?.label_serial ?? serial
                    setRobot({
                        type: RobotType.NeatoGen4,
                        serial,
                        name: entry.name,
                        online: true,
                        availableCommands: body.available_commands,
                        details: body.details,
                        errors: body.errors ?? undefined,
                        state: body.state,
                        action: body.action,
                        label_serial,
                    })
                })
                .catch((err) => {
                    console.warn('Gen4 getRobotState failed, falling back to cached state:', err)
                    setRobot(buildOfflineRobot(serial, entry, entry.last_state))
                })
        }
    }, [getGen3State, refreshZoneQueue])

    const selectRobot = useCallback((serial: string) => {
        const currentRobots = robotsRef.current
        const target = currentRobots?.[serial]
        if (!currentRobots || !target) return
        if (robotRef.current?.serial === serial && robotRef.current?.online === target.connected) {
            return
        }
        localStorage.setItem('vacuula.selectedRobot', serial)
        connectToRobot(currentRobots, serial, target)
    }, [connectToRobot])

    const refreshRobots = useCallback(async () => {
        const res = await Http.getRobots()
        setRobots(res.data)
        const cur = robotRef.current
        if (cur && !res.data[cur.serial]) {
            setRobot(undefined)
        }
    }, [])

    const updateRobotName = async (name: string) => {
        if (!robot) return
        const serial = robot.serial
        const previousName = robot.name

        setRobot(cur => cur && cur.serial === serial ? { ...cur, name } : cur)
        setRobots(cur => {
            if (!cur || !cur[serial]) return cur
            return { ...cur, [serial]: { ...cur[serial], name } }
        })

        try {
            await Http.updateRobot(serial, { name })
        } catch {
            setRobot(cur => cur && cur.serial === serial ? { ...cur, name: previousName } : cur)
            setRobots(cur => {
                if (!cur || !cur[serial]) return cur
                return { ...cur, [serial]: { ...cur[serial], name: previousName } }
            })
        }
    }

    // fetch floorplans/persistent maps whenever the selected robot changes
    useEffect(() => {
        if (!robot) return
        persistentMapsLoader.request(robot.serial).catch(err => console.error('Failed to fetch floorplans', err))
    }, [robot?.serial, robot?.type])

    // get robots, connect to preferred one (online or offline), then subscribe to updates
    useEffect(() => {
        const autoPickRobot = (data: QuickRobotInfo) => {
            if (robotRef.current) return
            const last = localStorage.getItem('vacuula.selectedRobot')
            const entries = Object.entries(data)
            if (entries.length === 0) return
            // Check if URL explicitly points to /robot/:serial
            const urlMatch = window.location.pathname.match(/\/robot\/([^/]+)/)
            const urlSerial = urlMatch ? decodeURIComponent(urlMatch[1]) : null

            const chosen =
                (urlSerial && data[urlSerial] ? [urlSerial, data[urlSerial]] as const : undefined) ??
                entries.find(([s, info]) => s === last && info.connected) ??
                entries.find(([, info]) => info.connected) ??
                entries.find(([s]) => s === last) ??
                entries[0]

            if (chosen) {
                connectToRobot(data, chosen[0], chosen[1])
            }
        }

        Http.getRobots().then((res) => {
            setRobots(res.data)
            autoPickRobot(res.data)
        })

        const events = new EventSource(`${BASE_PATH}/api/events`)
        events.addEventListener('robots', (event) => {
            const data = JSON.parse(event.data) as QuickRobotInfo
            setRobots(data)

            const cur = robotRef.current
            if (cur) {
                const updatedEntry = data[cur.serial]
                if (!updatedEntry) {
                    setRobot(undefined)
                } else if (updatedEntry.connected !== cur.online) {
                    connectToRobot(data, cur.serial, updatedEntry)
                }
                return
            }
            autoPickRobot(data)
        })

        events.addEventListener('queue', (event) => {
            try {
                const payload = JSON.parse(event.data) as { serial: string; queue: ZoneQueueState | null }
                if (payload?.serial) {
                    setZoneQueues(cur => ({ ...cur, [payload.serial]: payload.queue }))
                }
            } catch {
                // ignore malformed SSE payload
            }
        })

        events.onerror = (err) => console.error('events stream error:', err)
        return () => events.close()
    }, [connectToRobot])

    useEffect(() => {
        if (!robot || !robot.online) return

        const events = new EventSource(
            `${BASE_PATH}/api/robot/${robot.serial}/connect`,
        )

        events.onopen = () => {
            if (robot.type === RobotType.NeatoGen3) {
                GEN3_COMMANDS.getRobotState(robot.serial).then((res) => {
                    setRobot(cur => cur && cur.serial === robot.serial ? {
                        ...cur,
                        type: RobotType.NeatoGen3,
                        online: true,
                        availableCommands: res.data.availableCommands,
                        availableServices: res.data.availableServices ?? (cur.type === RobotType.NeatoGen3 ? cur.availableServices : undefined),
                        cleaning: res.data.cleaning ?? (cur.type === RobotType.NeatoGen3 ? cur.cleaning : undefined),
                        meta: res.data.meta ?? (cur.type === RobotType.NeatoGen3 ? cur.meta : undefined),
                        details: res.data.details,
                        alert: res.data.alert,
                        error: res.data.error,
                        state: res.data.state,
                        action: res.data.action,
                    } : cur)
                }).catch(() => {})
            } else if (robot.type === RobotType.NeatoGen4) {
                GEN4_COMMANDS.getRobotState(robot.serial).then((res) => {
                    const body = res.data.body
                    setRobot(cur => cur?.type === RobotType.NeatoGen4 && cur.serial === robot.serial ? {
                        ...cur,
                        type: RobotType.NeatoGen4,
                        online: true,
                        availableCommands: body.available_commands,
                        details: body.details,
                        errors: body.errors != null ? body.errors : undefined,
                        state: body.state,
                        action: body.action,
                    } : cur)
                }).catch(() => {})
            }
        }

        interface VacuulaRobotEvent {
            serial: string
            ts: number
            type: RobotType
            data: any
        }

        events.onmessage = (event) => {
            setLastHeartbeat(Date.now())
            const wrapper: VacuulaRobotEvent = JSON.parse(event.data)

            if (wrapper.type === RobotType.NeatoGen4) {
                const ev = wrapper.data as AnyEvent
                if (ev?.to?.service === OrbitalServices.PEER_STATE) {
                    const body = ev.body as Neato.Gen4.FullRobotState
                    setRobot(cur => cur?.type === RobotType.NeatoGen4 ? {
                        ...cur,
                        online: true,
                        availableCommands: body.available_commands,
                        details: body.details,
                        errors: body.errors != null ? body.errors : undefined,
                        state: body.state,
                        action: body.action,
                    } : cur)
                } else if (ev?.to?.service === OrbitalServices.ROBOTS_ERROR_CODES) {
                    const body: any = ev.body
                    const nextErrors: Neato.Gen4.Error[] | undefined = Array.isArray(body)
                        ? body
                        : Array.isArray(body?.errors)
                            ? body.errors
                            : body?.code
                                ? [{ code: body.code, severity: body.severity ?? Neato.Gen4.ErrorSeverity.ERROR }]
                                : undefined
                    setRobot(cur => cur?.type === RobotType.NeatoGen4 ? {
                        ...cur,
                        errors: nextErrors,
                    } : cur)
                }
                return
            }

            if (wrapper?.data?.type !== "state" && wrapper?.data?.eventId !== "77") {
                return
            }

            const d = wrapper.data.data
            if (!d) return
            setRobot(cur => cur?.type === RobotType.NeatoGen3 ? {
                ...cur,
                online: true,
                availableCommands: d.availableCommands ?? cur.availableCommands,
                availableServices: d.availableServices ?? cur.availableServices,
                cleaning: d.cleaning ?? cur.cleaning,
                meta: d.meta ?? cur.meta,
                details: d.details ?? cur.details,
                alert: d.alert,
                error: d.error,
                state: d.state ?? cur.state,
                action: d.action ?? cur.action,
            } : cur)
        }

        events.onerror = (err) => {
            console.error("SSE error:", err)
        }

        return () => {
            events.close()
        }
    }, [robot?.serial, robot?.type, robot?.online])

    if (!serverInfo) {
        return serverInfoError
            ? <ServerUnreachable onRetry={loadServerInfo} />
            : <Loading />
    }

    if (hasOutdatedRobot && robots) return <ServerHasOutdatedRobot robots={robots} serverInfo={serverInfo} />

    const value: AppContextType = {
        serverInfo,
        isDarkMode,
        setIsDarkMode,
        isLoading,
        setIsLoading,
        loadingState,
        setLoadingState,
        message,
        setMessage,
        robot,
        robots,
        selectRobot,
        refreshRobots,
        lastHeartbeat,
        zoneQueues,
        refreshZoneQueue,
        cleanings,
        setCleanings,
        updateRobotName,
        getGen3State,
    }

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    )
}

export { AppContext }
