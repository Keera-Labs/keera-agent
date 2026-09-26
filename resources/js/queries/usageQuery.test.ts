import { describe, expect, it } from 'vitest'
import { formatTokens, tokenBreakdown } from './usageQuery'

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
