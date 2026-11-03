import type { Neato } from '../../types'
import type { BasePose, NoGoLine, Point, Zone } from './types'
import { fetchGen3MapBoundaries } from '../../loaders/gen3Boundaries'

// RLE Decode helper
export function decodeRLE(rle: Array<any>) {
    const output: number[] = []
    for (const [value, count] of rle) {
        for (let i = 0; i < count; i++) {
            output.push(value)
        }
    }
    return output
}

// Touch helpers
export function getTouchDistance(t1: React.Touch, t2: React.Touch) {
    const dx = t1.clientX - t2.clientX
    const dy = t1.clientY - t2.clientY
    return Math.sqrt(dx * dx + dy * dy)
}

export function getTouchAngle(t1: React.Touch, t2: React.Touch) {
    const dx = t2.clientX - t1.clientX
    const dy = t2.clientY - t1.clientY
    return Math.atan2(dy, dx)
}

// Coordinate conversion
export function getWorldCoords(
    screenX: number,
    screenY: number,
    offset: { x: number; y: number },
    zoom: number,
    mapSize: { height: number; width: number }
): Point {
    return [
        ((screenX - offset.x) / zoom) / mapSize.width, // x
        ((screenY - offset.y) / zoom) / mapSize.height // y
    ]
}

export function getCanvasPointerWorldCoords(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
    offset: { x: number; y: number },
    zoom: number,
    mapSize: { height: number; width: number }
): Point {
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1
    const sx = (clientX - rect.left) * scaleX
    const sy = (clientY - rect.top) * scaleY
    return getWorldCoords(sx, sy, offset, zoom, mapSize)
}

export function getCrosshairWorldCoords(
    canvasRef: React.RefObject<HTMLCanvasElement | null | undefined>,
    offset: { x: number; y: number },
    zoom: number,
    mapSize?: { height: number; width: number }
): Point {
    const canvas = canvasRef.current
    if (!canvas || !mapSize) return [0, 0]
    // Center of screen in canvas coordinates
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    return getWorldCoords(centerX, centerY, offset, zoom, mapSize)
}

export function calcRelevancy(vertices: Point[]): Point {
    if (!vertices.length) return [0, 0]
    const x = vertices.reduce((sum, v) => sum + v[0], 0) / vertices.length
    const y = vertices.reduce((sum, v) => sum + v[1], 0) / vertices.length
    return [x, y]
}

// Ray-casting point-in-polygon hit test in normalized (0..1) world coords
export function isPointInPolygon(point: Point, vertices: Point[]): boolean {
    if (vertices.length < 3) return false
    const [px, py] = point
    let inside = false
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const [xi, yi] = vertices[i]
        const [xj, yj] = vertices[j]
        const intersect =
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-9) + xi
        if (intersect) inside = !inside
    }
    return inside
}

export function makeRectangleVertices(p1: Point, p2: Point): Point[] {
    const minX = Math.max(0, Math.min(1, Math.min(p1[0], p2[0])))
    const maxX = Math.max(0, Math.min(1, Math.max(p1[0], p2[0])))
    const minY = Math.max(0, Math.min(1, Math.min(p1[1], p2[1])))
    const maxY = Math.max(0, Math.min(1, Math.max(p1[1], p2[1])))
    return [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
    ]
}

export const upsertPreserveOrder = <T extends { id: string }>(
    list: T[],
    item: T
): T[] => {
    const index = list.findIndex(b => b.id === item.id)

    if (index === -1) return [...list, item]

    const copy = [...list]
    copy[index] = item
    return copy
}

export const CELL_FILTERS = {
    any: (v: number) => v !== 0,
    wallsOnly: (v: number) => v !== 0 && v !== 1,
    freeSpaceOnly: (v: number) => v === 1,
} as const


export function getMapContentBounds(
    cells: number[],
    mapSize: { width: number; height: number },
    runCells?: number[] | null,
    ignoreRunValues?: Set<number>
): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = mapSize.width
    let minY = mapSize.height
    let maxX = -1
    let maxY = -1

    const hasRun = !!runCells && runCells.length === cells.length

    for (let y = 0; y < mapSize.height; y++) {
        const row = y * mapSize.width
        for (let x = 0; x < mapSize.width; x++) {
            const idx = row + x
            const isFloorOrWall = cells[idx] !== 0
            const isRun = hasRun && runCells![idx] !== 0 && !ignoreRunValues?.has(runCells![idx])
            if (isFloorOrWall || isRun) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }

    if (maxX < minX || maxY < minY) return null // no non-empty cells at all

    return { minX, minY, maxX, maxY }
}

export function calcFitZoomAndOffset(
    cells: number[],
    mapSize: { width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
    minZoom: number,
    maxZoom: number,
    padding = 0.9, // fraction of canvas the content should occupy
    runCells?: number[] | null,
    ignoreRunValues?: Set<number>
): { zoom: number; offset: { x: number; y: number } } | null {
    const bounds = getMapContentBounds(cells, mapSize, runCells, ignoreRunValues)
    if (!bounds) return null

    const contentWidth = bounds.maxX - bounds.minX + 1
    const contentHeight = bounds.maxY - bounds.minY + 1

    if (contentWidth <= 0 || contentHeight <= 0) return null

    const zoomX = (canvasWidth * padding) / contentWidth
    const zoomY = (canvasHeight * padding) / contentHeight

    const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(zoomX, zoomY)))

    const contentCenterX = bounds.minX + contentWidth / 2
    const contentCenterY = bounds.minY + contentHeight / 2

    return {
        zoom,
        offset: {
            x: canvasWidth / 2 - contentCenterX * zoom,
            y: canvasHeight / 2 - contentCenterY * zoom
        }
    }
}

export interface Gen3MapWithZones {
    map: Neato.Gen3.PersistentMap
    boundaries: (NoGoLine | Zone)[]
    zones: Zone[]
}

export async function getAllGen3MapsWithZones(
    serial: string,
    maps: Neato.Gen3.PersistentMap[],
    online = true,
): Promise<Gen3MapWithZones[]> {
    return Promise.all(
        maps.map(async (map) => {
            if (!map.enabled) return { map, boundaries: [], zones: [] }
            try {
                const boundaries = await fetchGen3MapBoundaries(serial, map.id, online)
                return {
                    map,
                    boundaries,
                    zones: boundaries.filter((b): b is Zone => b.type === 'polygon'),
                }
            } catch (err) {
                console.error(`Failed to fetch boundaries for map ${map.id}`, err)
                return { map, boundaries: [], zones: [] }
            }
        }),
    )
}

/**
 * Resolves the dock / base pose and resolution across Gen 3 and Gen 4 map structures.
 * Supports:
 * - Gen 4: Cartesian [bx, by, bdir] with map metadata/origin and dimensions.
 * - Gen 3: Embed dock object { normalised_x, normalised_y } in floormap.json.
 * - Gen 3: PersistentMap.base array [x, y] or object { x, y } (normalised 0..1).
 */
export function extractBasePose(
    mapData?: any,
    fallbackMap?: any
): { pose: BasePose; resolution: number } | null {
    const src = mapData ?? fallbackMap
    if (!src) return null

    // 1. Gen 4: Cartesian coordinates [bx, by, bdir] with origin and imgsize
    const base = src.base ?? fallbackMap?.base
    const NO_BASE = 2147483647
    if (Array.isArray(base) && base.length >= 3 && base[0] !== NO_BASE && base[1] !== NO_BASE) {
        const origin = src.metadata
            ? [src.metadata.origin_x, src.metadata.origin_y]
            : (src.origin ?? fallbackMap?.origin)
        const resolution = src.metadata?.resolution ?? src.resolution ?? fallbackMap?.resolution ?? 40
        const imgsize = src.img_size ?? src.imgsize ?? fallbackMap?.img_size ?? fallbackMap?.imgsize
        if (origin && imgsize && imgsize[0] > 0 && imgsize[1] > 0 && resolution > 0) {
            const [bx, by, bdir] = base
            const [ox, oy] = origin
            const normX = (bx - ox) / resolution / imgsize[0]
            const normY = 1 - (by - oy) / resolution / imgsize[1]
            return {
                pose: {
                    x: Math.max(0, Math.min(1, normX)),
                    y: Math.max(0, Math.min(1, normY)),
                    dir: -(bdir ?? 0),
                },
                resolution,
            }
        }
    }

    // 2. Gen 3: dock info embedded in floormap JSON
    const dock = src.dock ?? fallbackMap?.dock
    if (dock && typeof dock.normalised_x === 'number' && typeof dock.normalised_y === 'number') {
        return {
            pose: {
                x: Math.max(0, Math.min(1, dock.normalised_x)),
                y: Math.max(0, Math.min(1, dock.normalised_y)),
                dir: 0,
            },
            resolution: src.metadata?.resolution ?? 40,
        }
    }

    // 3. Gen 3: base stored as [x, y] in PersistentMap (normalized 0..1)
    if (Array.isArray(base) && base.length >= 2 && typeof base[0] === 'number' && typeof base[1] === 'number') {
        const [x, y] = base
        if (x !== NO_BASE && y !== NO_BASE && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            return {
                pose: {
                    x,
                    y,
                    dir: typeof base[2] === 'number' ? base[2] : 0,
                },
                resolution: src.metadata?.resolution ?? 40,
            }
        }
    }

    // 4. Gen 3: base stored as { x, y }
    if (base && typeof base === 'object' && typeof base.x === 'number' && typeof base.y === 'number') {
        if (base.x >= 0 && base.x <= 1 && base.y >= 0 && base.y <= 1) {
            return {
                pose: {
                    x: base.x,
                    y: base.y,
                    dir: typeof base.dir === 'number' ? base.dir : 0,
                },
                resolution: src.metadata?.resolution ?? 40,
            }
        }
    }

    return null
}
