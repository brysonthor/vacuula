import { describe, it, expect } from 'vitest'
import {
    calcRelevancy,
    isPointInPolygon,
    makeRectangleVertices,
    getWorldCoords,
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
})
