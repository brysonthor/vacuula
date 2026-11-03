import { Http } from "../http"
import type { Neato } from "../types"


function getRobotState(serial: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotStateResponse>(serial, {
        ability: "state.show",
    }, true)
}

function findMe(serial: string) {
    return Http.sendCmd(serial, {
        ability: "utilities.find_me",
    })
}

function getSchedule(serial: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "scheduling.show",
    }, true)
}

function sendToBase(serial: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "navigation.return_to_base",
    })
}

function updateOrAddSchduledEvent(serial: string, event: Neato.Gen4.CommandEvent) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "scheduling.update",
        event,
    })
}

function deleteScheduledEvent(serial: string, id: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "scheduling.delete",
        id,
    })
}

function setScheduleEnabled(serial: string, enabled: boolean) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "scheduling.enable",
        enabled,
    })
}

function stopCleaning(serial: string) {
    return Http.sendCmd(serial, {
        ability: "cleaning.cancel",
    })
}

function pauseCleaning(serial: string) {
    return Http.sendCmd(serial, {
        ability: "cleaning.pause",
    })
}

function resumeCleaning(serial: string) {
    return Http.sendCmd(serial, {
        ability: "cleaning.resume",
    })
}


function getSettings<Op extends Neato.Gen4.SettingsGetOperation>(serial: string, settings: Neato.Gen4.RobotSettingsGet<Op>) {
    return Http.sendCmd<Neato.Gen4.BaseResponse<Neato.Gen4.SettingsMap[Op]>>(serial, {
        ability: settings.operation,
    }, true)
}

function setSettings<Op extends Neato.Gen4.SettingsSetOperation>(serial: string, settings: Neato.Gen4.RobotSettingsSet<Op>) {
    return Http.sendCmd<Neato.Gen4.BaseResponse<Neato.Gen4.SettingsMap[Op]>>(serial, {
        ability: settings.operation,
        ...settings.values
    })
}

function factoryReset(serial: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "settings.factory_reset"
    })
}

function demoteFloorplan(serial: string, id: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "maps.demote_floorplan",
        rank_uuid: id,
    })
}

function startCleaning(serial: string, mode: Neato.Gen4.CleaningMode, navigationMode: Neato.Gen4.CleaningNavigationMode, mapId?: string, nogoEnabled?: boolean, zoneIds?: string[]) {
    // no mapId = full possible clean
    // only mapId = cleaning of map, going around nogo lines and nogo zones
    // mapId & zoneId = clean that zone
    const settings = {
        mode,
        navigation_mode: navigationMode,
    };
    const runs = mapId === undefined ? [{ map: null, settings}] : 
        (zoneIds === undefined || zoneIds.length === 0) ? [{ map: { rank_id: mapId, track_id: null, nogo_enabled: !!nogoEnabled }, settings}] :
        zoneIds.map(z => ({ map: { rank_id: mapId, track_id: z, nogo_enabled: !!nogoEnabled }, settings}));

    return Http.sendCmd(serial, {
        ability: "cleaning.start",
        runs
    })
}

function startCleaningRuns(serial: string, runs: Neato.Gen4.SchduleRun[]) {
    return Http.sendCmd(serial, {
        ability: "cleaning.start",
        runs,
    })
}

function cleaningInfo(serial: string) {
    return Http.sendCmd<Neato.Gen4.BaseResponse<Neato.Gen4.CleaningInfo>>(serial, {
        ability: "cleaning.show",
    }, true)
}


export const GEN4_COMMANDS = {
    startCleaning,
    startCleaningRuns,
    stopCleaning,
    pauseCleaning,
    resumeCleaning,
    cleaningInfo,
    sendToBase,

    getSchedule,
    updateOrAddSchduledEvent,
    deleteScheduledEvent,
    setScheduleEnabled,

    demoteFloorplan,
    getSettings,
    setSettings,

    getRobotState,
    findMe,

    factoryReset
}
