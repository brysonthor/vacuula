import { describe, it, expect } from 'vitest'
import {
    calcRelevancy,
    isPointInPolygon,
    makeRectangleVertices,
    getWorldCoords,
    extractBasePose,
    getMapContentBounds,
    calcFitZoomAndOffset,
} from './utils'
import type { Point } from './types'

describe('map utils', () => {
    describe('calcRelevancy', () => {
        it('returns [0, 0] for empty vertices', () => {
            expect(calcRelevancy([])).toEqual([0, 0])
        })

        it('calculates the centroid accurately for polygons', () => {
            const square: Point[] = [
                [0.1, 0.1],
                [0.3, 0.1],
                [0.3, 0.3],
                [0.1, 0.3],
            ]
            const [cx, cy] = calcRelevancy(square)
            expect(cx).toBeCloseTo(0.2)
            expect(cy).toBeCloseTo(0.2)
        })
    })

    describe('isPointInPolygon', () => {
        const poly: Point[] = [
            [0.2, 0.2],
            [0.8, 0.2],
            [0.8, 0.8],
            [0.2, 0.8],
        ]

        it('returns true when point is inside', () => {
            expect(isPointInPolygon([0.5, 0.5], poly)).toBe(true)
            expect(isPointInPolygon([0.3, 0.4], poly)).toBe(true)
        })

        it('returns false when point is outside', () => {
            expect(isPointInPolygon([0.1, 0.1], poly)).toBe(false)
            expect(isPointInPolygon([0.9, 0.5], poly)).toBe(false)
        })

        it('returns false for polygons with fewer than 3 vertices', () => {
            expect(isPointInPolygon([0.5, 0.5], [[0.1, 0.1], [0.2, 0.2]])).toBe(false)
        })
    })

    describe('makeRectangleVertices', () => {
        it('normalizes and bounds rectangles within [0, 1]', () => {
            const verts = makeRectangleVertices([0.2, 0.8], [0.6, 0.4])
            expect(verts).toEqual([
                [0.2, 0.4],
                [0.6, 0.4],
                [0.6, 0.8],
                [0.2, 0.8],
            ])
        })

        it('clamps coordinates exceeding 0..1 boundary', () => {
            const verts = makeRectangleVertices([-0.5, -0.2], [1.5, 1.2])
            expect(verts).toEqual([
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
            ])
        })
    })

    describe('getWorldCoords', () => {
        it('translates screen coords to normalized world coordinates', () => {
            const point = getWorldCoords(100, 200, { x: 0, y: 0 }, 1, { width: 1000, height: 1000 })
            expect(point[0]).toBeCloseTo(0.1)
            expect(point[1]).toBeCloseTo(0.2)
        })
    })

    describe('extractBasePose', () => {
        it('extracts base pose from Gen 4 Cartesian floorplan format', () => {
            const gen4Plan = {
                base: [2000, 3000, 45],
                origin: [0, 0],
                resolution: 40,
                imgsize: [100, 100],
            }
            const result = extractBasePose(gen4Plan)
            expect(result).not.toBeNull()
            expect(result?.resolution).toBe(40)
            expect(result?.pose.x).toBeCloseTo(2000 / 40 / 100) // 0.5
            expect(result?.pose.y).toBeCloseTo(1 - (3000 / 40 / 100)) // 0.25
            expect(result?.pose.dir).toBe(-45)
        })

        it('extracts base pose from Gen 3 floormap dock format', () => {
            const gen3Map = {
                dock: {
                    normalised_x: 0.42,
                    normalised_y: 0.68,
                },
            }
            const result = extractBasePose(gen3Map)
            expect(result).toEqual({
                pose: {
                    x: 0.42,
                    y: 0.68,
                    dir: 0,
                },
                resolution: 40,
            })
        })

        it('extracts base pose from Gen 3 PersistentMap array format [x, y]', () => {
            const gen3PersistentMap = {
                base: [0.35, 0.75],
            }
            const result = extractBasePose(gen3PersistentMap)
            expect(result).toEqual({
                pose: {
                    x: 0.35,
                    y: 0.75,
                    dir: 0,
                },
                resolution: 40,
            })
        })

        it('extracts base pose from Gen 3 PersistentMap object format {x, y}', () => {
            const gen3ObjMap = {
                base: { x: 0.2, y: 0.8 },
            }
            const result = extractBasePose(gen3ObjMap)
            expect(result).toEqual({
                pose: {
                    x: 0.2,
                    y: 0.8,
                    dir: 0,
                },
                resolution: 40,
            })
        })

        it('returns null for NO_BASE or invalid values', () => {
            expect(extractBasePose({ base: [2147483647, 2147483647, 0] })).toBeNull()
            expect(extractBasePose(null)).toBeNull()
            expect(extractBasePose({})).toBeNull()
        })
    })

    describe('getMapContentBounds', () => {
        it('includes both floor (1) and wall (2) cells in the bounds', () => {
            // 5x5 map with floor at (1, 1) and wall at (3, 3)
            const mapSize = { width: 5, height: 5 }
            const cells = new Array(25).fill(0)
            cells[1 * 5 + 1] = 1 // floor
            cells[3 * 5 + 3] = 2 // wall

            const bounds = getMapContentBounds(cells, mapSize)
            expect(bounds).toEqual({
                minX: 1,
                minY: 1,
                maxX: 3,
                maxY: 3,
            })
        })

        it('includes runCells within the content bounds', () => {
            const mapSize = { width: 5, height: 5 }
            const cells = new Array(25).fill(0)
            cells[2 * 5 + 2] = 1
            const runCells = new Array(25).fill(0)
            runCells[0 * 5 + 4] = 10 // run path extends to top right

            const bounds = getMapContentBounds(cells, mapSize, runCells)
            expect(bounds).toEqual({
                minX: 2,
                minY: 0,
                maxX: 4,
                maxY: 2,
            })
        })

        it('returns null when no content exists', () => {
            const mapSize = { width: 5, height: 5 }
            const cells = new Array(25).fill(0)
            expect(getMapContentBounds(cells, mapSize)).toBeNull()
        })
    })

    describe('calcFitZoomAndOffset', () => {
        it('calculates fit zoom and centered offset properly for large maps without clipping', () => {
            // 500x500 map with content from (50, 50) to (450, 450)
            const mapSize = { width: 500, height: 500 }
            const cells = new Array(500 * 500).fill(0)
            cells[50 * 500 + 50] = 1
            cells[450 * 500 + 450] = 2

            // Canvas is 200px wide and 200px high
            const fit = calcFitZoomAndOffset(cells, mapSize, 200, 200, 0.05, 60, 0.9)
            expect(fit).not.toBeNull()
            if (!fit) return

            // Content width/height is 401. With padding 0.9, available size is 180px.
            // Expected zoom: 180 / 401 ~= 0.4488
            expect(fit.zoom).toBeCloseTo(180 / 401, 3)

            // Verify content is centered in the canvas:
            // contentCenter = 50 + 401 / 2 = 250.5
            // offset = 200 / 2 - 250.5 * zoom = 100 - 250.5 * zoom
            const expectedOffset = 100 - 250.5 * fit.zoom
            expect(fit.offset.x).toBeCloseTo(expectedOffset, 2)
            expect(fit.offset.y).toBeCloseTo(expectedOffset, 2)

            // Top-most content point at y=50 in screen coordinates:
            const topScreenY = fit.offset.y + 50 * fit.zoom
            // Bottom-most content point at y=450 in screen coordinates:
            const bottomScreenY = fit.offset.y + 450 * fit.zoom

            // Both must be strictly inside the canvas (0..200), not cut off!
            expect(topScreenY).toBeGreaterThanOrEqual(0)
            expect(bottomScreenY).toBeLessThanOrEqual(200)
            expect(topScreenY).toBeCloseTo(10, 0)
        })
    })
})
