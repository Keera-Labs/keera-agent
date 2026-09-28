// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiFontSize, cacheUiFontSize, clampUiFontSize, readCachedUiFontSize } from './uiFontSize'

const uiScale = () => document.documentElement.style.getPropertyValue('--ui-scale')

beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.removeProperty('--ui-scale')
})

afterEach(() => vi.unstubAllGlobals())

describe('uiFontSize', () => {
    it('clamps to 11-18 and falls back to the default for junk', () => {
        expect(clampUiFontSize(4)).toBe(11)
        expect(clampUiFontSize(40)).toBe(18)
        expect(clampUiFontSize(14.6)).toBe(15)
        expect(clampUiFontSize(Number.NaN)).toBe(13)
    })

    it('maps the default 13px to a scale of exactly 1', () => {
        applyUiFontSize(13)
        expect(uiScale()).toBe('1')

        applyUiFontSize(18)
        expect(Number(uiScale())).toBeCloseTo(18 / 13)
    })

    it('reads back the cached size, defaulting when nothing or junk is stored', () => {
        expect(readCachedUiFontSize()).toBe(13)

        cacheUiFontSize(16)
        expect(readCachedUiFontSize()).toBe(16)

        localStorage.setItem('keera.ui-font-size', 'huge')
        expect(readCachedUiFontSize()).toBe(13)
    })

    it('uses the default when storage is unavailable', () => {
        const denied = () => { throw new Error('denied') }
        vi.stubGlobal('localStorage', { getItem: denied, setItem: denied })

        expect(() => cacheUiFontSize(16)).not.toThrow()
        expect(readCachedUiFontSize()).toBe(13)
    })
})
