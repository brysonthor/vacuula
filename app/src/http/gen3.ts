import { Http } from "../http"
import type { NoGoLine, SetZone, Zone } from "../components/map/types"
import { GEN3_MAX_POINTS_PER_BOUNDARY, roundPoint } from "../components/map/gen3Budget"
import type { ScheduleEvent } from "../pages/schedule/types"
import type { Neato } from "../types"
import type { Preferences } from "../types/neato/gen3"
import type { GetMapBoundariesResponse, GetPreferencesResponse, GetScheduleResponse, RobotBaseResponse } from "../types/neato/gen3/api"
import { CleaningCategory, CleaningMode, CleaningModifier, CleaningNavigationMode, type GetRobotStateResponse } from "../types/neato/gen3/state"



function getLocalStats(serial: string) {
    return Http.sendCmd(serial, { cmd: "getLocalStats" })
}

function getRobotState(serial: string) {
    return Http.sendCmd<GetRobotStateResponse>(serial, { cmd: "getRobotState" }, true)
}

function getGeneralInfo(serial: string) {
    return Http.sendCmd<Neato.Gen3.GetGeneralInfoResponse>(serial, { cmd: "getGeneralInfo" })
}

function getRobotInfo() {
    return { cmd: "getRobotInfo" }
}

function dismissCurrentAlert(serial: string) {
    return Http.sendCmd(serial, { cmd: "dismissCurrentAlert" })
}

function findMe(serial: string) {
    return Http.sendCmd(serial, { cmd: "findMe" })
}


function uploadLogs(serial: string, recentCount = 1) {
    return Http.sendCmd(serial, {
        cmd: "uploadLogs",
        params: {
            recentCount
        }
    })
}

function getLogsUploadState(serial: string) {
    return Http.sendCmd(serial, { cmd: "getLogsUploadState" }, true)
}


function sendToBase(serial: string) {
    return Http.sendCmd(serial, { cmd: "sendToBase" })
}

function stopCleaning(serial: string) {
    return Http.sendCmd(serial, { cmd: "stopCleaning" })
}

function pauseCleaning(serial: string) {
    return Http.sendCmd(serial, { cmd: "pauseCleaning" })
}

function resumeCleaning(serial: string) {
    return Http.sendCmd(serial, { cmd: "resumeCleaning" })
}

function startCleaning(
    serial: string,
    category: CleaningCategory,
    mode: CleaningMode,
    navigationMode: CleaningNavigationMode,
    modifier: CleaningModifier = CleaningModifier.NORMAL
) {
    return Http.sendCmd(serial, {
        cmd: "startCleaning",
        params: {
            category,
            mode,
            modifier,
            navigationMode,
        }
    })
}

function startCleaningSpot(
    serial: string,
    height: number,
    width: number,
    mode: CleaningMode,
    navigationMode: CleaningNavigationMode,
    modifier: CleaningModifier = CleaningModifier.NORMAL
) {
    return Http.sendCmd(serial, {
        cmd: "startCleaning",
        params: {
            category: CleaningCategory.SPOT,
            mode,
            modifier,
            navigationMode,
            spotHeight: height,
            spotWidth: width,
        }
    })
}

function startCleaningZone(
    serial: string,
    mapId: string,
    zoneId: string,
    mode: CleaningMode,
    navigationMode: CleaningNavigationMode,
    modifier: CleaningModifier = CleaningModifier.NORMAL
) {
    return Http.sendCmd(serial, {
        cmd: "startCleaning",
        params: {
            category: CleaningCategory.MAP,
            mode,
            modifier,
            navigationMode,
            mapId,
            boundaryId: zoneId,
        }
    })
}

// Is this really how it works?
function startCleaningZones(
    serial: string,
    zoneIds: string[],
    mode: CleaningMode,
    navigationMode: CleaningNavigationMode,
    modifier: CleaningModifier = CleaningModifier.NORMAL
) {
    return Http.sendCmd(serial, {
        cmd: "startCleaning",
        params: {
            category: CleaningCategory.MAP,
            mode,
            modifier,
            navigationMode,
            boundaryIds: zoneIds,
        }
    })
}




function getPreferences(serial: string) {
    return Http.sendCmd<GetPreferencesResponse>(serial, { cmd: "getPreferences" }, true)
}

function setPreferences(serial: string, preferences: Preferences) {
    return Http.sendCmd(serial, { cmd: "setPreferences", params: preferences})
}


function startPersistentMapExploration(serial: string) {
    return Http.sendCmd(serial, { cmd: "startPersistentMapExploration" })
}

function getMapBoundaries(serial: string, mapId: string) {
    return Http.sendCmd<GetMapBoundariesResponse>(serial, { cmd: "getMapBoundaries", params: { mapId } }, true)
}


function setMapBoundaries(serial: string, mapId: string, boundaries: (NoGoLine | SetZone | Zone)[]) {
    const sanitized = boundaries.map(b => ({
        ...b,
        vertices: (b.vertices || []).slice(0, GEN3_MAX_POINTS_PER_BOUNDARY).map(roundPoint)
    }))
    return Http.sendCmd(serial, { cmd: "setMapBoundaries", params: { mapId, boundaries: sanitized } })
}

function getSchedule(serial: string) {
    return Http.sendCmd<GetScheduleResponse>(serial, { cmd: "getSchedule" }, true)
}

function setSchedule(serial: string, events: ScheduleEvent[]) {
    return Http.sendCmd(serial, { cmd: "setSchedule", params: { events } })
}

function enableSchedule(serial: string) {
    return Http.sendCmd<RobotBaseResponse<{}>>(serial, { cmd: "enableSchedule" })
}

function disableSchedule(serial: string) {
    return Http.sendCmd<RobotBaseResponse<{}>>(serial, { cmd: "disableSchedule" })
}

export const GEN3_COMMANDS = {
    getLocalStats,
    getRobotState,
    getGeneralInfo,
    getRobotInfo,
    dismissCurrentAlert,
    sendToBase,
    stopCleaning,
    pauseCleaning,
    resumeCleaning,
    startCleaning,
    startCleaningSpot,
    startCleaningZone,
    startCleaningZones,
    getPreferences,
    setPreferences,
    findMe,
    getMapBoundaries,
    setMapBoundaries,
    startPersistentMapExploration,

    getSchedule,
    setSchedule,
    enableSchedule,
    disableSchedule,

    uploadLogs,
    getLogsUploadState
}
