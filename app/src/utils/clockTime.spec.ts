import { describe, it, expect } from 'vitest'
import {
    parseHHMM,
    formatHHMM,
    shiftClockSlot,
    utcSlotToLocal,
    localSlotToUtc,
    formatUtcOffset,
    type ClockSlot,
} from './clockTime'

describe('clockTime utils', () => {
    it('parseHHMM parses valid 24h strings', () => {
        expect(parseHHMM('00:00')).toBe(0)
        expect(parseHHMM('12:30')).toBe(750)
        expect(parseHHMM('23:59')).toBe(1439)
        expect(parseHHMM('9:05')).toBe(545)
    })

    it('parseHHMM returns null on invalid input', () => {
        expect(parseHHMM('24:00')).toBeNull()
        expect(parseHHMM('12:60')).toBeNull()
        expect(parseHHMM('invalid')).toBeNull()
        expect(parseHHMM('')).toBeNull()
    })

    it('formatHHMM formats minutes since midnight', () => {
        expect(formatHHMM(0)).toBe('00:00')
        expect(formatHHMM(750)).toBe('12:30')
        expect(formatHHMM(1439)).toBe('23:59')
        expect(formatHHMM(-60)).toBe('23:00')
        expect(formatHHMM(1500)).toBe('01:00')
    })

    it('shiftClockSlot shifts time and handles weekday rollover', () => {
        const slot: ClockSlot = { time: '23:30', day: 2 } // Tuesday 23:30
        // +60 min -> Wednesday 00:30
        const shiftedForward = shiftClockSlot(slot, 60)
        expect(shiftedForward).toEqual({ time: '00:30', day: 3 })

        // -60 min -> Tuesday 22:30
        const shiftedBack = shiftClockSlot(slot, -60)
        expect(shiftedBack).toEqual({ time: '22:30', day: 2 })

        // -120 min from Sunday 01:00 -> Saturday 23:00
        const sundaySlot: ClockSlot = { time: '01:00', day: 0 }
        const wrappedSat = shiftClockSlot(sundaySlot, -120)
        expect(wrappedSat).toEqual({ time: '23:00', day: 6 })

        // Invalid time returns original slot unchanged
        expect(shiftClockSlot({ time: 'bad', day: 1 }, 60)).toEqual({ time: 'bad', day: 1 })
    })

    it('utcSlotToLocal and localSlotToUtc round-trip correctly', () => {
        const original: ClockSlot = { time: '14:00', day: 4 }
        const offset = -420 // -7 hours (MST)
        const local = utcSlotToLocal(original, offset)
        expect(local).toEqual({ time: '07:00', day: 4 })

        const backToUtc = localSlotToUtc(local, offset)
        expect(backToUtc).toEqual(original)
    })

    it('formatUtcOffset formats friendly timezone strings', () => {
        expect(formatUtcOffset(0)).toBe('UTC')
        expect(formatUtcOffset(60)).toBe('UTC+01:00')
        expect(formatUtcOffset(-420)).toBe('UTC-07:00')
        expect(formatUtcOffset(330)).toBe('UTC+05:30')
    })
})
