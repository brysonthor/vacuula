import { describe, it, expect, beforeEach } from 'vitest'
import {
    getGen3CleaningMode,
    getGen3NavigationMode,
    getGen4CleaningMode,
    getGen4NavigationMode,
} from './modes'
import { parseVersion, isRobotOutdated } from './version'
import { resolveRobotState, getRobotStateKey, getRobotStateString, BasicState } from './state'
import { Neato, RobotType, type Robot } from '../types'

describe('modes utils', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('returns defaults when localStorage is empty', () => {
        expect(getGen3CleaningMode()).toBe(Neato.Gen3.CleaningMode.ECO)
        expect(getGen3NavigationMode()).toBe(Neato.Gen3.CleaningNavigationMode.NORMAL)
        expect(getGen4CleaningMode()).toBe(Neato.Gen4.CleaningMode.ECO)
        expect(getGen4NavigationMode()).toBe(Neato.Gen4.CleaningNavigationMode.NORMAL)
    })

    it('returns stored values from localStorage', () => {
        localStorage.setItem('vacuula.gen3.cleaningMode', String(Neato.Gen3.CleaningMode.NORMAL))
        localStorage.setItem('vacuula.gen3.navigationMode', String(Neato.Gen3.CleaningNavigationMode.EXTRA_CARE))
        localStorage.setItem('vacuula.gen4.cleaningMode', Neato.Gen4.CleaningMode.TURBO)
        localStorage.setItem('vacuula.gen4.navigationMode', Neato.Gen4.CleaningNavigationMode.GENTLE)

        expect(getGen3CleaningMode()).toBe(Neato.Gen3.CleaningMode.NORMAL)
        expect(getGen3NavigationMode()).toBe(Neato.Gen3.CleaningNavigationMode.EXTRA_CARE)
        expect(getGen4CleaningMode()).toBe(Neato.Gen4.CleaningMode.TURBO)
        expect(getGen4NavigationMode()).toBe(Neato.Gen4.CleaningNavigationMode.GENTLE)
    })
})

describe('version utils', () => {
    it('parseVersion correctly parses semantic version with beta rank', () => {
        expect(parseVersion('1.2.3')).toEqual([1, 2, 3, Infinity])
        expect(parseVersion('2.0.1-b4')).toEqual([2, 0, 1, 4])
        expect(parseVersion('invalid')).toEqual([-999, -999, -999, -Infinity])
    })

    it('isRobotOutdated compares against minimum installer version', () => {
        expect(isRobotOutdated('1.0.0', '1.1.0')).toBe(true)
        expect(isRobotOutdated('1.1.0', '1.1.0')).toBe(false)
        expect(isRobotOutdated('2.0.0', '1.1.0')).toBe(false)
        expect(isRobotOutdated('1.1.0-b1', '1.1.0')).toBe(true)
        expect(isRobotOutdated('dev-build', '1.1.0')).toBe(false)
    })
})

describe('state utils', () => {
    const dummyGen3Robot: Robot = {
        serial: 'OPS123',
        type: RobotType.NeatoGen3,
        name: 'Gen3',
        state: Neato.Gen3.RobotState.IDLE,
        action: Neato.Gen3.RobotAction.HOUSE_CLEANING,
        battery: 80,
    } as any

    const dummyGen4Robot: Robot = {
        serial: '2126LB',
        type: RobotType.NeatoGen4,
        name: 'Gen4',
        state: Neato.Gen4.RobotState.IDLE,
        action: Neato.Gen4.RobotAction.CLEANING,
        battery: 90,
    } as any

    it('resolves Gen 3 states and actions', () => {
        expect(resolveRobotState({ ...dummyGen3Robot, state: Neato.Gen3.RobotState.ERROR })).toBe(BasicState.ERROR)
        expect(resolveRobotState({ ...dummyGen3Robot, state: Neato.Gen3.RobotState.PAUSED })).toBe(BasicState.PAUSED)
        expect(resolveRobotState({ ...dummyGen3Robot, state: Neato.Gen3.RobotState.IDLE })).toBe(BasicState.IDLE)

        expect(resolveRobotState({ ...dummyGen3Robot, state: 0 as any, action: Neato.Gen3.RobotAction.HOUSE_CLEANING })).toBe(BasicState.CLEANING)
        expect(resolveRobotState({ ...dummyGen3Robot, state: 0 as any, action: Neato.Gen3.RobotAction.DOCKING })).toBe(BasicState.DOCKING)
        expect(resolveRobotState({ ...dummyGen3Robot, state: 0 as any, action: Neato.Gen3.RobotAction.COPYING_LOGS })).toBe(BasicState.COPYING_LOGS)
        expect(resolveRobotState({ ...dummyGen3Robot, state: 0 as any, action: Neato.Gen3.RobotAction.RECOVERING_LOCATION })).toBe(BasicState.RECOVERING_LOCATION)
        expect(resolveRobotState({ ...dummyGen3Robot, state: 0 as any, action: Neato.Gen3.RobotAction.EXPLORING_MAP })).toBe(BasicState.EXPLORING_MAP)
        expect(resolveRobotState({ ...dummyGen3Robot, state: Neato.Gen3.RobotState.BUSY, action: Neato.Gen3.RobotAction.INVALID })).toBe(BasicState.CLEANING)
    })

    it('resolves Gen 4 states and actions', () => {
        expect(resolveRobotState({ ...dummyGen4Robot, state: Neato.Gen4.RobotState.ERROR })).toBe(BasicState.ERROR)
        expect(resolveRobotState({ ...dummyGen4Robot, state: Neato.Gen4.RobotState.PAUSED })).toBe(BasicState.PAUSED)
        expect(resolveRobotState({ ...dummyGen4Robot, state: Neato.Gen4.RobotState.IDLE })).toBe(BasicState.IDLE)

        expect(resolveRobotState({ ...dummyGen4Robot, state: 0 as any, action: Neato.Gen4.RobotAction.DOCKING })).toBe(BasicState.DOCKING)
        expect(resolveRobotState({ ...dummyGen4Robot, state: 0 as any, action: Neato.Gen4.RobotAction.CLEANING })).toBe(BasicState.CLEANING)
        expect(resolveRobotState({ ...dummyGen4Robot, state: 0 as any, action: Neato.Gen4.RobotAction.CLEANING_STANDBY })).toBe(BasicState.CLEANING_STANDBY)
        expect(resolveRobotState({ ...dummyGen4Robot, state: 0 as any, action: Neato.Gen4.RobotAction.DIAGNOSTIC_TEST })).toBe(BasicState.TEST)
        expect(resolveRobotState({ ...dummyGen4Robot, state: 0 as any, action: Neato.Gen4.RobotAction.UPDATING_SOFTWARE })).toBe(BasicState.UPDATING)
        expect(resolveRobotState({ ...dummyGen4Robot, state: Neato.Gen4.RobotState.BUSY, action: Neato.Gen4.RobotAction.INVALID })).toBe(BasicState.CLEANING)
    })

    it('returns translation keys and string representations', () => {
        const key = getRobotStateKey(dummyGen3Robot)
        expect(key).toBe('state.idle')

        const str = getRobotStateString(dummyGen3Robot)
        expect(typeof str).toBe('string')
    })
})
