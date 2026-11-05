import { describe, expect, it } from 'vitest'
import { GEN3_MAX_POINTS_PER_BOUNDARY, GEN3_REPLY_LIMIT, gen3ReplyBytes, roundPoint, type Boundary } from './gen3Budget'

describe('gen3Budget', () => {
    it('rounds points to 4 decimal places', () => {
        expect(roundPoint([0.1234567, 0.9876543])).toEqual([0.1235, 0.9877])
        expect(roundPoint([0.5, 0.25])).toEqual([0.5, 0.25])
    })

    it('enforces limits constants', () => {
        expect(GEN3_MAX_POINTS_PER_BOUNDARY).toBe(10)
        expect(GEN3_REPLY_LIMIT).toBe(2044)
    })

    it('calculates estimated reply bytes accurately', () => {
        const sampleBoundary: Boundary = {
            id: 'zone-1',
            name: 'Kitchen',
            color: '#ff0000',
            type: 'polygon',
            enabled: true,
            vertices: [
                [0.1, 0.1],
                [0.2, 0.1],
                [0.2, 0.2],
                [0.1, 0.2],
            ],
        }
        const bytes = gen3ReplyBytes([sampleBoundary])
        expect(bytes).toBeGreaterThan(100)
        expect(bytes).toBeLessThan(GEN3_REPLY_LIMIT)
    })
})
