import { Neato, RobotType, type Robot } from "../types"
import i18n from "../i18n"


export enum BasicState {
    INVALID,
    ERROR,
    PAUSED,
    IDLE,
    DOCKING,
    CLEANING,
    CLEANING_STANDBY,
    UPDATING,
    TEST,

    // gen3 only
    COPYING_LOGS,
    RECOVERING_LOCATION, // gen4 shows an alert
    EXPLORING_MAP,
    ACQUIRING_PERSISTENT_MAP_IDS,
    CREATING_UPLOADING_MAP,
    SUSPENDED_EXPLORATION, // ?
}

const basicStateKeys = {
    [BasicState.INVALID]: "state.invalid",
    [BasicState.ERROR]: "state.error",
    [BasicState.PAUSED]: "state.paused",
    [BasicState.IDLE]: "state.idle",
    [BasicState.DOCKING]: "state.docking",
    [BasicState.CLEANING]: "state.cleaning",
    [BasicState.CLEANING_STANDBY]: "state.cleaningStandby",
    [BasicState.UPDATING]: "state.updating",
    [BasicState.TEST]: "state.test",

    // gen3 only
    [BasicState.COPYING_LOGS]: "state.copyingLogs",
    [BasicState.RECOVERING_LOCATION]: "state.recoveringLocation",
    [BasicState.EXPLORING_MAP]: "state.exploringMap",
    [BasicState.ACQUIRING_PERSISTENT_MAP_IDS]: "state.acquiringPersistentMapIds",
    [BasicState.CREATING_UPLOADING_MAP]: "state.creatingUploadingMap",
    [BasicState.SUSPENDED_EXPLORATION]: "state.suspendedExploration",
} as const satisfies Record<BasicState, string>

// Translation key for the robot's current state; render it with t(getRobotStateKey(robot))
export function getRobotStateKey(robot: Robot) {
    return basicStateKeys[resolveRobotState(robot)];
}

// Translated state label, for use outside React components
export function getRobotStateString(robot: Robot) {
    return i18n.t(getRobotStateKey(robot));
}

export function resolveRobotState(robot: Robot) {
    // off wibes i guess lol
    if (robot.type === RobotType.NeatoGen3) {
        switch (robot.state) {
            case Neato.Gen3.RobotState.ERROR: return BasicState.ERROR
            case Neato.Gen3.RobotState.PAUSED: return BasicState.PAUSED
            case Neato.Gen3.RobotState.IDLE: return BasicState.IDLE
        }
        switch (robot.action) {
            case Neato.Gen3.RobotAction.HOUSE_CLEANING: return BasicState.CLEANING
            case Neato.Gen3.RobotAction.SPOT_CLEANING: return BasicState.CLEANING
            case Neato.Gen3.RobotAction.MANUAL_CLEANING: return BasicState.CLEANING
            case Neato.Gen3.RobotAction.MAP_CLEANING: return BasicState.CLEANING
            case Neato.Gen3.RobotAction.DOCKING: return BasicState.DOCKING
            case Neato.Gen3.RobotAction.USER_MENU_ACTIVE: return BasicState.TEST // ?
            case Neato.Gen3.RobotAction.SUSPENDED_CLEANING: return BasicState.CLEANING_STANDBY // ?
            case Neato.Gen3.RobotAction.UPDATING: return BasicState.UPDATING

            case Neato.Gen3.RobotAction.COPYING_LOGS: return BasicState.COPYING_LOGS
            case Neato.Gen3.RobotAction.RECOVERING_LOCATION: return BasicState.RECOVERING_LOCATION
            case Neato.Gen3.RobotAction.EXPLORING_MAP: return BasicState.EXPLORING_MAP
            case Neato.Gen3.RobotAction.ACQUIRING_PERSISTENT_MAP_IDS: return BasicState.ACQUIRING_PERSISTENT_MAP_IDS
            case Neato.Gen3.RobotAction.CREATING_UPLOADING_MAP: return BasicState.CREATING_UPLOADING_MAP
            case Neato.Gen3.RobotAction.SUSPENDED_EXPLORATION: return BasicState.SUSPENDED_EXPLORATION
        }
        if (robot.state === Neato.Gen3.RobotState.BUSY) {
            return BasicState.CLEANING
        }
    }

    // robot_state.py:55-96
    if (robot.type === RobotType.NeatoGen4) {
        switch (robot.state) {
            case Neato.Gen4.RobotState.ERROR: return BasicState.ERROR
            case Neato.Gen4.RobotState.PAUSED: return BasicState.PAUSED
            case Neato.Gen4.RobotState.IDLE: return BasicState.IDLE
        }
        switch (robot.action) {
            case Neato.Gen4.RobotAction.DOCKING: return BasicState.DOCKING
            case Neato.Gen4.RobotAction.CLEANING: return BasicState.CLEANING
            case Neato.Gen4.RobotAction.CLEANING_STANDBY: return BasicState.CLEANING_STANDBY
            case Neato.Gen4.RobotAction.DIAGNOSTIC_TEST: return BasicState.TEST
            case Neato.Gen4.RobotAction.UPDATING_SOFTWARE: return BasicState.UPDATING
        }
        if (robot.state === Neato.Gen4.RobotState.BUSY) {
            return BasicState.CLEANING
        }
    }

    return BasicState.INVALID;
}