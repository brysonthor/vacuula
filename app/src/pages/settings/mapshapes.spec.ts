import { describe, it, expect, beforeEach } from 'vitest'
import {
    MAPSHAPES,
    DEFAULT_MAPSHAPE,
    saveSelectedMapShape,
    loadSelectedMapShape,
} from './mapshapes'

describe('mapshapes settings', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('returns default mapshape when none is saved', () => {
        expect(loadSelectedMapShape()).toBe(DEFAULT_MAPSHAPE)
    })

    it('saves and loads valid mapshape', () => {
        saveSelectedMapShape('heart')
        expect(loadSelectedMapShape()).toBe('heart')

        saveSelectedMapShape('square')
        expect(loadSelectedMapShape()).toBe('square')
    })

    it('falls back to default mapshape if localStorage contains invalid shape', () => {
        localStorage.setItem('vacuula.mapShape', 'triangle')
        expect(loadSelectedMapShape()).toBe(DEFAULT_MAPSHAPE)
    })
})
