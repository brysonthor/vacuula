import axios from "axios";
import i18n from "./i18n";
import {
  Neato,
  type ConsumableItem,
  type DriveCombo,
  type DriveCommand,
  type DriveStatus,
  type NotificationSettings,
  type QuickRobotInfo,
  type RobotLogArchive,
  type RobotTelemetryResponse,
  type ScheduleSkipState,
  type ServerScheduleItem,
  type ZoneQueueItem,
  type ZoneQueueState,
} from "./types";
import type { NoGoLine, VacuulaMapData, Zone } from "./components/map/types";

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipLoader?: boolean;
  }
}

const ha_ingress = window.location.pathname.match(/^\/api\/hassio_ingress\/[^/]+/)
export const BASE_PATH = ha_ingress ? ha_ingress[0] : ""

/** GET /api/server */
export interface ServerInfo {
  version: string
  min_installer_version: string
  gen3_port: number
  gen4_port: number

  timezone: string
  utc_offset_minutes: number
}

const instance = axios.create({
  baseURL: `${BASE_PATH}/api`, 
});

export type LoadingState = { isLoading: boolean; message?: string };

let loadingStateCallback: ((state: LoadingState) => void) | null = null;
let pendingRequests = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const startLoading = () => {
  pendingRequests += 1;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (pendingRequests === 1) {
    loadingStateCallback?.({ isLoading: true, message: i18n.t('common.sendingCommand') });
  }
};

const stopLoading = () => {
  pendingRequests = Math.max(0, pendingRequests - 1);
  if (pendingRequests === 0) {
    // small delay avoids flicker when requests fire back to back
    hideTimer = setTimeout(() => {
      hideTimer = null;
      loadingStateCallback?.({ isLoading: false });
    }, 150);
  }
};


instance.interceptors.request.use((config) => {
  if (!config.skipLoader) startLoading();
  return config;
});

instance.interceptors.response.use(
  (response) => {
    if (!response.config.skipLoader) stopLoading();
    return response;
  },
  (error) => {
    if (!error.config?.skipLoader) stopLoading();
    return Promise.reject(error);
  }
);

export class Http {
  static sendCmd<T>(robotSerial: string, cmd: object, skipLoader = false) {
    return instance.post<T>(`/robot/${robotSerial}/command`, JSON.stringify(cmd), { skipLoader });
  }

  static getPersistentMaps(serial: string) {
    return instance.get<Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[]>(`/robot/${serial}/maps`)
  }

  static getPersistentMap(serial: string, mapId: string) {
    return instance.get<VacuulaMapData>(`/robot/${serial}/maps/${mapId}`)
  }

  static postUseMapAsFloorPlan(serial: string, mapId: string) {
    return instance.post(`/robot/${serial}/maps/${mapId}/use`)
  }

  static postUnuseMapAsFloorPlan(serial: string, mapId: string) {
    return instance.post(`/robot/${serial}/maps/${mapId}/unuse`)
  }

  static updatePersistentMap(serial: string, mapId: string, data: { name?: string, enabled?: boolean }) {
    return instance.post(`/robot/${serial}/maps/${mapId}`, data)
  }

  static postBoundaries(serial: string, mapId: string, data: (NoGoLine | Zone)[]) {
    return instance.post(`/robot/${serial}/maps/${mapId}/boundaries`, data)
  }

  static getBoundaries(serial: string, mapId: string) {
    return instance.get(`/robot/${serial}/maps/${mapId}/boundaries`)
  }

  static promoteFloorplan(serial: string, mapId: string) {
    return instance.post<{ promoted: boolean; rank_uuid: string; schedules_restored?: boolean }>(`/robot/${serial}/maps/${mapId}/promote`)
  }

  static getCleanings(serial: string) {
    return instance.get(`/robot/${serial}/runs`)
  }

  static getCleaning(serial: string, runId: string) {
    return instance.get(`/robot/${serial}/run/${runId}`)
  }

  static demoteFloorplan(serial: string, mapId: string) {
    return instance.delete(`/robot/${serial}/maps/${mapId}`)
  }

  static getRobots() {
    return instance.get<QuickRobotInfo>('/robots');
  }

  /** Server facts the UI needs: the IANA timezone it runs in and its current UTC offset. */
  static getServerInfo() {
    return instance.get<ServerInfo>('/server');
  }

  static getVacuulaCert() {
    return instance.get('/cert');
  }

  static updateRobot(serial: string, data: { name: string }) {
    return instance.post(`/robot/${serial}`, data)
  }

  // Notifications
  static getNotificationSettings() {
    return instance.get<NotificationSettings>('/settings/notifications', { skipLoader: true })
  }

  static saveNotificationSettings(data: Partial<NotificationSettings>) {
    return instance.post<NotificationSettings>('/settings/notifications', data)
  }

  static testNotificationSettings(discord_webhook_url?: string) {
    return instance.post<{ ok: boolean; message: string }>('/settings/notifications/test', { discord_webhook_url })
  }

  // Server Logs
  static getServerLogs(full = false) {
    return instance.get<string>(full ? '/log/full' : '/log', {
      responseType: 'text',
      skipLoader: true,
    })
  }

  // Telemetry & Robot Logs
  static getRobotTelemetry(serial: string, refresh = false) {
    return instance.get<RobotTelemetryResponse>(
      `/robot/${serial}/telemetry${refresh ? '?refresh=true' : ''}`,
      { skipLoader: !refresh }
    )
  }

  static getRobotLogs(serial: string) {
    return instance.get<RobotLogArchive[]>(`/robot/${serial}/logs`, { skipLoader: true })
  }

  static getRobotLogDownloadUrl(serial: string, jobId: string, filename: string) {
    return `${BASE_PATH}/api/robot/${encodeURIComponent(serial)}/logs/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`
  }

  // Consumables
  static getConsumables(serial: string) {
    return instance.get<ConsumableItem[]>(`/robot/${serial}/consumables`, { skipLoader: true })
  }

  static resetConsumable(serial: string, consumable: string, threshold_hours?: number) {
    return instance.post<ConsumableItem[]>(`/robot/${serial}/consumables/reset`, {
      consumable,
      threshold_hours,
    })
  }

  static updateConsumableThreshold(serial: string, consumable: string, threshold_hours: number) {
    return instance.post<ConsumableItem[]>(`/robot/${serial}/consumables/threshold`, {
      consumable,
      threshold_hours,
    })
  }

  // Hybrid Server Schedules & Skip Next Run
  static getServerSchedules(serial: string) {
    return instance.get<ServerScheduleItem[]>(`/robot/${serial}/server-schedules`, { skipLoader: true })
  }

  static saveServerSchedule(serial: string, data: Partial<ServerScheduleItem>) {
    return instance.post<ServerScheduleItem>(`/robot/${serial}/server-schedules`, data)
  }

  static deleteServerSchedule(serial: string, id: string) {
    return instance.delete<{ deleted: boolean }>(`/robot/${serial}/server-schedules/${id}`)
  }

  static getScheduleSkip(serial: string) {
    return instance.get<ScheduleSkipState>(`/robot/${serial}/schedule-skip`, { skipLoader: true })
  }

  static activateScheduleSkip(serial: string, skip_until_iso?: string) {
    return instance.post<ScheduleSkipState & { ok?: boolean; error?: string }>(
      `/robot/${serial}/schedule-skip`,
      { skip_until_iso }
    )
  }

  static cancelScheduleSkip(serial: string) {
    return instance.delete<ScheduleSkipState>(`/robot/${serial}/schedule-skip`)
  }

  // Multi-Zone Queue & Ephemeral "Clean Here"
  static getZoneQueue(serial: string) {
    return instance.get<{ queue: ZoneQueueState | null }>(`/robot/${serial}/queue`, { skipLoader: true })
  }

  static startZoneQueue(
    serial: string,
    data: {
      zones: ZoneQueueItem[]
      mode?: number
      modifier?: number
      navigationMode?: number
    }
  ) {
    return instance.post<{ ok: boolean; queue?: ZoneQueueState; error?: string }>(
      `/robot/${serial}/queue`,
      data
    )
  }

  static cancelZoneQueue(serial: string, stopRobot = false) {
    return instance.delete<{ cancelled: boolean }>(
      `/robot/${serial}/queue${stopRobot ? '?stop=true' : ''}`
    )
  }

  static startCleanHere(
    serial: string,
    data: {
      map_id: string
      vertices: [number, number][]
      mode?: number | string
      modifier?: number
      navigationMode?: number | string
      nogo_enabled?: boolean
    }
  ) {
    return instance.post<{ ok: boolean; error?: string }>(`/robot/${serial}/clean-here`, data)
  }

  static dockRobot(serial: string) {
    return instance.post<{
      ok: boolean
      message?: string
      docking?: boolean
      docked?: boolean
      error?: string
    }>(`/robot/${serial}/dock`, {})
  }

  // Gen 3 Manual Remote Drive
  static driveStart(serial: string) {
    return instance.post<DriveStatus>(`/robot/${serial}/drive/start`, {})
  }

  static driveInput(serial: string, data: { combo?: DriveCombo; command?: DriveCommand }) {
    return instance.post<DriveStatus>(`/robot/${serial}/drive/input`, data, { skipLoader: true })
  }

  static driveStop(serial: string) {
    return instance.post<{ connected: boolean; stopped: boolean }>(`/robot/${serial}/drive/stop`, {})
  }

  static driveStatus(serial: string) {
    return instance.get<DriveStatus>(`/robot/${serial}/drive/status`, { skipLoader: true })
  }

  // Cleanup Endpoints
  static deleteRun(serial: string, runId: string) {
    return instance.delete<{ deleted: boolean; run_id: string }>(`/robot/${serial}/run/${runId}`)
  }

  static purgeMap(serial: string, mapId: string) {
    return instance.delete<{ deleted: boolean; map_id: string }>(`/robot/${serial}/maps/${mapId}/purge`)
  }

  static deleteRobot(serial: string) {
    return instance.delete<{ deleted: boolean; serial: string }>(`/robot/${serial}`)
  }

  static setLoadingStateCallback(cb: ((state: LoadingState) => void) | null) {
    loadingStateCallback = cb;
  }
}
