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

    it('keeps every letter tile\'s text at WCAG AA contrast (4.5:1)', () => {
        // Tailwind v4's sRGB fallbacks for the classes in the palette; happy-dom resolves no styles.
        const HEX: Record<string, string> = {
            'bg-blue-600': '#155dfc', 'bg-amber-400': '#ffb900', 'bg-emerald-700': '#007a55',
            'bg-violet-600': '#7f22fe', 'bg-pink-600': '#e60076', 'bg-teal-700': '#00786f',
            'text-white': '#ffffff', 'text-amber-950': '#461901',
        }
        const luminance = (hex: string) => {
            const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
                .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        for (const color of PROJECT_COLORS) {
            const [a, b] = [luminance(HEX[color.tile]), luminance(HEX[color.tileText])].sort((x, y) => y - x)
            expect((a + 0.05) / (b + 0.05), color.name).toBeGreaterThanOrEqual(4.5)
        }
    })

    it('pairs every tile with a tint of the same hue', () => {
        for (const color of PROJECT_COLORS) {
            expect(color.tint.split('-')[1]).toBe(color.tile.split('-')[1])
        }
    })
})
