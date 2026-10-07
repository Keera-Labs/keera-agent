import { describe, expect, it } from 'vitest'
import { contextDetail, formatResetsIn, formatTokens, limitDetail, tokenBreakdown } from './usageQuery'

describe('formatTokens', () => {
    it.each([
        [0, '0 tok'],
        [999, '999 tok'],
        [1_000, '1K tok'],
        [45_060, '45.1K tok'],
        [1_250_330, '1.3M tok'],
        [2_000_000_000, '2B tok'],
    ])('formats %i as %s', (count, expected) => {
        expect(formatTokens(count)).toBe(expected)
    })
})

describe('tokenBreakdown', () => {
    it('lists each token kind and the last model', () => {
        const usage = { input: 1_200, output: 30, cache_creation: 4, cache_read: 5, total: 1_239, last_model: 'claude-opus-5' }

        expect(tokenBreakdown(usage)).toBe(
            'Input: 1,200\nOutput: 30\nCache write: 4\nCache read: 5\nLast model: claude-opus-5',
        )
    })
})

describe('plan limit helpers', () => {
    const now = 1_000_000_000_000
    const at = (minutes: number) => now / 1000 + minutes * 60

    it('formats the time until a reset', () => {
        expect(formatResetsIn(at(7), now)).toBe('7m')
        expect(formatResetsIn(at(125), now)).toBe('2h 5m')
        expect(formatResetsIn(at(3 * 1440 + 240), now)).toBe('3d 4h')
        expect(formatResetsIn(at(-5), now)).toBe('0m')
    })

    it('describes a limit window', () => {
        expect(limitDetail('Weekly limit', { used_percentage: 41.2, resets_at: at(60) }, now))
            .toBe('Weekly limit: 41% used, resets in 1h 0m')
        expect(limitDetail('5-hour limit', { used_percentage: 3, resets_at: null }, now)).toBe('5-hour limit: 3% used')
    })

    it('describes the context fill only when reported', () => {
        const report = {
            agent_id: 1, model: null, five_hour: null, seven_day: null,
            context_used_percentage: 8, context_window_size: 1_000_000, updated_at: null,
        }
        expect(contextDetail(report)).toBe('Context: 8% of 1M tok')
        expect(contextDetail({ ...report, context_used_percentage: null })).toBeNull()
        expect(contextDetail(undefined)).toBeNull()
    })
})
