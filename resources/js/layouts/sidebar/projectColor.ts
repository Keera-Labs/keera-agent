export interface ProjectColor {
    name: string
    /** The group header pill's solid fill. */
    fill: string
    /** A foreground that stays readable on `fill`. */
    text: string
    /** The rule down the left of the group's agent rows. */
    border: string
}

// Full class strings, so Tailwind's scanner sees every one of them.
export const PROJECT_COLORS: readonly ProjectColor[] = [
    { name: 'blue', fill: 'bg-blue-600', text: 'text-white', border: 'border-blue-600' },
    { name: 'amber', fill: 'bg-amber-400', text: 'text-amber-950', border: 'border-amber-400' },
    { name: 'green', fill: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-600' },
    { name: 'purple', fill: 'bg-violet-600', text: 'text-white', border: 'border-violet-600' },
    { name: 'pink', fill: 'bg-pink-500', text: 'text-white', border: 'border-pink-500' },
    { name: 'teal', fill: 'bg-teal-600', text: 'text-white', border: 'border-teal-600' },
]

/**
 * A project's group color, keyed by its id so it never changes across reloads
 * or renames. Sequential ids walk the palette, so neighbours rarely share a color.
 */
export function projectColor(projectId: number): ProjectColor {
    const length = PROJECT_COLORS.length
    return PROJECT_COLORS[((Math.trunc(projectId) % length) + length) % length]
}
