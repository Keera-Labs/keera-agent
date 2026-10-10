export interface ProjectColor {
    name: string
    /** The pale wash behind the whole project card. */
    tint: string
    /** The letter tile's solid fill. */
    tile: string
    /** A foreground that stays readable on `tile`. */
    tileText: string
}

// Full class strings, so Tailwind's scanner sees every one of them.
export const PROJECT_COLORS: readonly ProjectColor[] = [
    { name: 'blue', tint: 'bg-blue-50', tile: 'bg-blue-600', tileText: 'text-white' },
    { name: 'amber', tint: 'bg-amber-100', tile: 'bg-amber-400', tileText: 'text-amber-950' },
    { name: 'green', tint: 'bg-emerald-50', tile: 'bg-emerald-700', tileText: 'text-white' },
    { name: 'purple', tint: 'bg-violet-50', tile: 'bg-violet-600', tileText: 'text-white' },
    { name: 'pink', tint: 'bg-pink-50', tile: 'bg-pink-600', tileText: 'text-white' },
    { name: 'teal', tint: 'bg-teal-50', tile: 'bg-teal-700', tileText: 'text-white' },
]

/**
 * A project's card color, keyed by its id so it never changes across reloads
 * or renames. Sequential ids walk the palette, so neighbours rarely share a color.
 */
export function projectColor(projectId: number): ProjectColor {
    const length = PROJECT_COLORS.length
    return PROJECT_COLORS[((Math.trunc(projectId) % length) + length) % length]
}
