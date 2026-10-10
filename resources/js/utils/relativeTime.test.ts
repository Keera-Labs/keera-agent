import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

describe('relativeTime', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')

    it.each([
        ['2026-09-26T11:59:30Z', 'now'],
        ['2026-09-26T11:55:00Z', '5m'],
        ['2026-09-26T09:00:00Z', '3h'],
        ['2026-09-24T12:00:00Z', '2d'],
        ['2026-09-26T12:05:00Z', 'now'],
    ])('formats %s as %s', (iso, expected) => {
        expect(relativeTime(iso, now)).toBe(expected)
    })

    it('is empty without a valid timestamp', () => {
        expect(relativeTime(null, now)).toBe('')
        expect(relativeTime('not a date', now)).toBe('')
    })
})
