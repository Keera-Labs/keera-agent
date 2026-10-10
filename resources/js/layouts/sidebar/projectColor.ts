export interface ProjectColor {
    name: string
    tint: string
    tile: string
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

export function projectColor(projectId: number): ProjectColor {
    const length = PROJECT_COLORS.length
    return PROJECT_COLORS[((Math.trunc(projectId) % length) + length) % length]
}
