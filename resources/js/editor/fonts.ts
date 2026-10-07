export type FontFamilyId = 'dank-mono' | 'fira-code' | 'monaco' | 'jetbrains-mono'

export interface FontOption {
    id: FontFamilyId
    label: string
    /** Bundled via @fontsource; the others are used only when installed locally. */
    shipped: boolean
}

export const FONT_OPTIONS: FontOption[] = [
    { id: 'dank-mono', label: 'Dank Mono', shipped: false },
    { id: 'fira-code', label: 'Fira Code', shipped: true },
    { id: 'monaco', label: 'Monaco', shipped: false },
    { id: 'jetbrains-mono', label: 'JetBrains Mono', shipped: true },
]

export const MIN_FONT_SIZE = 11
export const MAX_FONT_SIZE = 20

export const FONT_SIZE_PRESETS: { size: number; label: string }[] = [
    { size: 11, label: 'Compact' },
    { size: 13, label: 'Default' },
    { size: 14, label: 'Recommended' },
    { size: 16, label: 'Comfort' },
    { size: 20, label: 'Large' },
]

export function fontLabel(id: FontFamilyId): string {
    return FONT_OPTIONS.find(f => f.id === id)?.label ?? id
}

/** The chosen face first, then the bundled Fira Code so a missing local font never falls to a proportional one. */
export function fontStack(id: FontFamilyId): string {
    return `"${fontLabel(id)}", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace`
}

export function clampFontSize(size: number): number {
    if (!Number.isFinite(size)) return MIN_FONT_SIZE
    return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)))
}

/**
 * document.fonts.check() reports true for any family it has no @font-face for,
 * so a local font is detected by whether it changes the rendered width against
 * two different generic fallbacks.
 */
export function isFontInstalled(label: string): boolean {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return false
    const sample = 'mmmmmmmmmwwwwwwwiiiiil1|0O'
    return ['monospace', 'serif'].some(fallback => {
        ctx.font = `72px ${fallback}`
        const base = ctx.measureText(sample).width
        ctx.font = `72px "${label}", ${fallback}`
        return ctx.measureText(sample).width !== base
    })
}

export function isFontAvailable(option: FontOption): boolean {
    return option.shipped || isFontInstalled(option.label)
}
