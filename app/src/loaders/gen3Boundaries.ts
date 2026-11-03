import { GEN3_COMMANDS } from '../http/gen3'
import type { NoGoLine, Zone } from '../components/map/types'

export type Boundaries = (NoGoLine | Zone)[]

// "serial:mapId" -> boundaries
export const gen3Boundaries: Record<string, Boundaries> = {}
const k = (serial: string, mapId: string) => `${serial}:${mapId}`
const storageKey = (serial: string, mapId: string) => `vacuula.gen3Bounds.${serial}:${mapId}`

function filterEphemeral(list: Boundaries): Boundaries {
    return (list || []).filter(b => b && b.name !== '__vacuula_clean_here__')
}

function readStoredBoundaries(serial: string, mapId: string): Boundaries {
    try {
        const raw = localStorage.getItem(storageKey(serial, mapId))
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? filterEphemeral(parsed) : []
    } catch {
        return []
    }
}

export function setCachedGen3Boundaries(serial: string, mapId: string, list: Boundaries) {
    const cleanList = filterEphemeral(list)
    gen3Boundaries[k(serial, mapId)] = cleanList
    try {
        localStorage.setItem(storageKey(serial, mapId), JSON.stringify(cleanList))
    } catch {
        // ignore storage quota
    }
}

// fetch one map from the robot and save it in memory + localStorage cache for offline viewing
export async function fetchGen3MapBoundaries(serial: string, mapId: string, online = true) {
    if (!online) {
        if (!gen3Boundaries[k(serial, mapId)]) {
            gen3Boundaries[k(serial, mapId)] = readStoredBoundaries(serial, mapId)
        }
        return gen3Boundaries[k(serial, mapId)]
    }
    try {
        const res = await GEN3_COMMANDS.getMapBoundaries(serial, mapId)
        const rawList = res.data.data.boundaries ?? []
        const list = filterEphemeral(rawList)
        setCachedGen3Boundaries(serial, mapId, list)
        return list
    } catch {
        if (!gen3Boundaries[k(serial, mapId)]) {
            gen3Boundaries[k(serial, mapId)] = readStoredBoundaries(serial, mapId)
        }
        return gen3Boundaries[k(serial, mapId)]
    }
}

// fetch all maps one at a time, skipping the ones already cached
export async function fetchAllGen3Boundaries(serial: string, maps: { id: string }[], online = true) {
    for (const map of maps) {
        if (gen3Boundaries[k(serial, map.id)]) continue
        await fetchGen3MapBoundaries(serial, map.id, online)
    }
}

export const getCachedBoundaries = (serial: string, mapId: string): Boundaries => {
    if (!gen3Boundaries[k(serial, mapId)]) {
        gen3Boundaries[k(serial, mapId)] = readStoredBoundaries(serial, mapId)
    }
    return filterEphemeral(gen3Boundaries[k(serial, mapId)] ?? [])
}

export const getCachedZones = (serial: string, mapId: string): Zone[] =>
    getCachedBoundaries(serial, mapId).filter((b): b is Zone => b.type === 'polygon')
