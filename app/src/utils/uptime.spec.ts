import { describe, it, expect } from 'vitest'
import { computeFleetAverageUptimeSeconds, computeRobotUptimeSeconds, formatUptime } from './uptime'

describe('formatUptime', () => {
    it('handles zero and negative or invalid values gracefully', () => {
        expect(formatUptime(0)).toBe('0s')
        expect(formatUptime(-10)).toBe('0s')
        expect(formatUptime(NaN)).toBe('0s')
        expect(formatUptime(Infinity)).toBe('0s')
    })

    it('formats seconds under 1 minute', () => {
        expect(formatUptime(1)).toBe('1s')
        expect(formatUptime(45)).toBe('45s')
        expect(formatUptime(59)).toBe('59s')
        expect(formatUptime(59.9)).toBe('59s')
    })

    it('formats minutes and seconds under 1 hour', () => {
        expect(formatUptime(60)).toBe('1m 00s')
        expect(formatUptime(75)).toBe('1m 15s')
        expect(formatUptime(605)).toBe('10m 05s')
        expect(formatUptime(3599)).toBe('59m 59s')
    })

    it('formats hours, minutes, and seconds under 24 hours', () => {
        expect(formatUptime(3600)).toBe('1h 00m 00s')
        expect(formatUptime(3665)).toBe('1h 01m 05s')
        expect(formatUptime(7322)).toBe('2h 02m 02s')
        expect(formatUptime(86399)).toBe('23h 59m 59s')
    })

    it('formats days, hours, minutes, and seconds for 24+ hours', () => {
        expect(formatUptime(86400)).toBe('1d 00h 00m 00s')
        expect(formatUptime(90065)).toBe('1d 01h 01m 05s')
        expect(formatUptime(259200 + 3600 * 5 + 60 * 12 + 34)).toBe('3d 05h 12m 34s')
    })
})

describe('computeRobotUptimeSeconds', () => {
    it('returns null when robot is offline', () => {
        expect(computeRobotUptimeSeconds({ connected: false })).toBeNull()
        expect(computeRobotUptimeSeconds({ connected: false, uptime: 100 })).toBeNull()
    })

    it('computes uptime from connected_at timestamp', () => {
        const now = 1700000000000
        const connectedAt = new Date(now - 75000).toISOString()
        expect(computeRobotUptimeSeconds({ connected: true, connected_at: connectedAt }, now)).toBe(75)
    })

    it('falls back to uptime field when connected_at is absent', () => {
        expect(computeRobotUptimeSeconds({ connected: true, uptime: 300 })).toBe(300)
    })

    it('returns 0 when connected but no timing info provided', () => {
        expect(computeRobotUptimeSeconds({ connected: true })).toBe(0)
    })
})

describe('computeFleetAverageUptimeSeconds', () => {
    it('returns null when no robots are online', () => {
        expect(computeFleetAverageUptimeSeconds({})).toBeNull()
        expect(computeFleetAverageUptimeSeconds({
            bot1: { connected: false },
            bot2: { connected: false },
        })).toBeNull()
    })

    it('calculates average uptime across online robots', () => {
        const now = 1700000000000
        const robots = {
            bot1: { connected: true, connected_at: new Date(now - 100000).toISOString() }, // 100s
            bot2: { connected: true, uptime: 200 }, // 200s
            bot3: { connected: false, uptime: 5000 }, // offline -> ignored
        }
        expect(computeFleetAverageUptimeSeconds(robots, now)).toBe(150)
    })
})

