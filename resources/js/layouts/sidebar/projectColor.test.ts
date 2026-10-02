import { describe, expect, it } from 'vitest'
import { PROJECT_COLORS, projectColor } from './projectColor'

describe('projectColor', () => {
    it('returns the same color for the same project id', () => {
        expect(projectColor(42)).toBe(projectColor(42))
    })

    it('gives consecutive projects different colors', () => {
        const names = PROJECT_COLORS.map((_, i) => projectColor(i + 1).name)
        expect(new Set(names).size).toBe(PROJECT_COLORS.length)
    })

    it('stays within the palette for any id', () => {
        for (const id of [0, 1, 7, 1_000_003, -5]) {
            expect(PROJECT_COLORS).toContain(projectColor(id))
        }
    })

    it('pairs every pill fill with a border of the same hue', () => {
        for (const color of PROJECT_COLORS) {
            expect(color.border).toBe(color.fill.replace(/^bg-/, 'border-'))
        }
    })
})
