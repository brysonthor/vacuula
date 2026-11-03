import type { Neato } from './neato'

export * from './neato'

export enum RobotType {
    NeatoGen3 = "neato.gen3",
    NeatoGen4 = "neato.gen4"
}
// TODO: a better system for handleing robots from other manufacturers maybe?

export interface QuickRobotEntry {
    type: RobotType
    name: string
    connected: boolean

    installed_with?: string // only for gen3
    label_serial?: string // only for gen4

    // Enriched fleet summary fields from /api/robots & SSE
    model?: string | null
    firmware?: string | null
    ip_address?: string | null
    last_seen_at?: string | null
    charge?: number | null
    is_docked?: boolean | null
    is_charging?: boolean | null
    state_label?: string | null
    has_error?: boolean
    error_code?: string | null
    last_state?: any
}

export interface QuickRobotInfo {
    [serial: string]: QuickRobotEntry
}

export interface Gen3Robot {
    type: RobotType.NeatoGen3

    error?: Neato.Gen3.RobotError
    alert?: Neato.Gen3.RobotAlert
    availableCommands: Neato.Gen3.AvailableCommands
    availableServices?: Neato.Gen3.AvailableServices
    cleaning?: Neato.Gen3.Cleaning
    meta?: Neato.Gen3.Meta
    details: Neato.Gen3.Details
    state: Neato.Gen3.RobotState
    action: Neato.Gen3.RobotAction
}

export interface Gen4Robot {
    type: RobotType.NeatoGen4

    errors?: Neato.Gen4.Error[]
    availableCommands: Neato.Gen4.AvailableCommands
    details: Neato.Gen4.Details
    state: Neato.Gen4.RobotState
    action: Neato.Gen4.RobotAction
}

export type Robot = {
    name: string
    serial: string
    online: boolean
} & (Gen3Robot | (Gen4Robot & { label_serial: string }))

export interface NotificationSettings {
    discord_webhook_url: string
    enabled: boolean
    events: {
        connectivity: boolean
        cleaning: boolean
        errors: boolean
        run_summary: boolean
        consumables: boolean
        [key: string]: boolean
    }
}

export interface ConsumableItem {
    consumable: 'main_brush' | 'side_brush' | 'filter' | 'sensors' | string
    used_hours: number
    threshold_hours: number
    remaining_hours: number
    percent_remaining: number
    reset_at: string | null
    needs_attention: boolean
}

export interface RobotTelemetryResponse {
    serial: string
    online: boolean
    ip_address: string | null
    model: string | null
    firmware: string | null
    last_seen_at: string | null
    info: Record<string, any>
    stats: Record<string, any>
    last_state: Record<string, any>
}

export interface RobotLogArchive {
    job_id: string
    filename: string
    size_bytes: number
    uploaded_at: number
}

export interface ServerSchedulePayload {
    category?: number | string
    mode?: number | string
    modifier?: number
    navigationMode?: number | string
    map_id?: string
    nogo_enabled?: boolean
    zones?: Array<{
        id: string
        name?: string
        mode?: number | string
        modifier?: number
        navigationMode?: number | string
    }>
    runs?: Neato.Gen4.SchduleRun[]
}

export interface ServerScheduleItem {
    id: string
    robot: string
    name: string
    enabled: boolean
    schedule_type: 'one_off' | 'recurring'
    run_at_iso?: string | null
    days: Array<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | string>
    time_hhmm: string
    payload: ServerSchedulePayload
    last_triggered_key?: string | null
    created_at: string
}

export interface ScheduleSkipState {
    active?: boolean
    robot?: string
    skip_until_iso?: string | null
    created_at?: string | null
}

export interface ZoneQueueItem {
    id: string
    name: string
    mode?: number
    modifier?: number
    navigationMode?: number
}

export interface ZoneQueueState {
    id: string
    serial: string
    zones: ZoneQueueItem[]
    current_index: number
    status: 'running' | 'waiting_next' | 'cancelled' | string
    total: number
}

export type DriveCombo =
    | 'forward'
    | 'back'
    | 'stop'
    | 'arc-left'
    | 'arc-right'
    | 'pivot-left'
    | 'pivot-right'

export type DriveCommand =
    | 'vacuum-on'
    | 'vacuum-off'
    | 'eco-on'
    | 'eco-off'
    | 'turbo-on'
    | 'turbo-off'
    | 'brush-on'
    | 'brush-off'
    | 'clean-spot'

export interface DriveStatus {
    connected: boolean
    ip_address?: string
    port?: number
    ssid?: string | null
    active_combo?: DriveCombo | string
    vacuum_on?: boolean
    brush_on?: boolean
    eco_on?: boolean
    robot_message?: Record<string, any> | null
}
