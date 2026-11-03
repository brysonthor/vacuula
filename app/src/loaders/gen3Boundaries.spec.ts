import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    gen3Boundaries,
    setCachedGen3Boundaries,
    getCachedBoundaries,
    getCachedZones,
    fetchGen3MapBoundaries,
    fetchAllGen3Boundaries,
} from './gen3Boundaries'
import { GEN3_COMMANDS } from '../http/gen3'

describe('gen3Boundaries loader', () => {
    beforeEach(() => {
        localStorage.clear()
        for (const k in gen3Boundaries) {
            delete gen3Boundaries[k]
        }
    })

    it('sets and retrieves boundaries from memory and localStorage', () => {
        const list = [
            { id: 'b1', name: 'Kitchen', type: 'polygon', vertices: [[0, 0], [1, 0], [1, 1]] },
            { id: 'b2', name: '__vacuula_clean_here__', type: 'polygon', vertices: [[0, 0]] },
        ] as any

        setCachedGen3Boundaries('bot-1', 'map-1', list)

        // Ephemeral zone is filtered out
        const cached = getCachedBoundaries('bot-1', 'map-1')
        expect(cached.length).toBe(1)
        expect(cached[0].name).toBe('Kitchen')

        const zones = getCachedZones('bot-1', 'map-1')
        expect(zones.length).toBe(1)
        expect(zones[0].type).toBe('polygon')
    })

    it('reads from stored boundaries when robot is offline', async () => {
        localStorage.setItem(
            'vacuula.gen3Bounds.bot-off:map-1',
            JSON.stringify([{ id: 'b1', name: 'Stored Zone', type: 'polygon', vertices: [] }])
        )

        const bounds = await fetchGen3MapBoundaries('bot-off', 'map-1', false)
        expect(bounds.length).toBe(1)
        expect(bounds[0].name).toBe('Stored Zone')
    })

    it('fetches from API when online', async () => {
        vi.spyOn(GEN3_COMMANDS, 'getMapBoundaries').mockResolvedValueOnce({
            data: {
                data: {
                    boundaries: [
                        { id: 'remote-1', name: 'Living Room', type: 'polygon', vertices: [] },
                    ],
                },
            },
        } as any)

        const bounds = await fetchGen3MapBoundaries('bot-on', 'map-2', true)
        expect(bounds.length).toBe(1)
        expect(bounds[0].name).toBe('Living Room')

        // Second fetch uses cached boundaries in fetchAllGen3Boundaries
        await fetchAllGen3Boundaries('bot-on', [{ id: 'map-2' }], true)
    })
})
