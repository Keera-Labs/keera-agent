const v = (name: string) => `var(${name})`

export const color = {
    // ── Custom tokens ─────────────────────────────────────
    canvas:  v('--color-canvas'),
    surface: v('--color-surface'),
    stroke:  v('--color-stroke'),
    accent:  v('--color-accent'),
    success: v('--color-success'),
    danger:  v('--color-danger'),
    overlay: 'rgba(0,0,0,0.6)',

    // ── Aliases (AppLayout inline-style compat) ────────────
    bgCanvas:       v('--color-canvas'),
    bgBase:         v('--color-canvas'),
    bgSurface:      v('--color-surface'),
    border:         v('--color-stroke'),
    borderMuted:    v('--color-stroke'),

    // Text — Tailwind zinc scale
    textPrimary:   v('--color-zinc-200'),
    textSecondary: v('--color-zinc-300'),
    textTertiary:  v('--color-zinc-400'),
    textMuted:     v('--color-zinc-400'),
    textGhost:     v('--color-zinc-500'),
    textFaint:     v('--color-zinc-500'),

    // Accent shades — Tailwind blue scale
    accentMuted:    v('--color-blue-300'),
    accentEmphasis: v('--color-blue-700'),
    accentSubtle:   v('--color-blue-900'),
    accentGlow:     'rgba(88,166,255,0.07)',

    // Success shades
    successEmphasis: v('--color-success'),
    successBorder:   v('--color-success'),

    // Warning — Tailwind amber scale
    warning:       v('--color-amber-500'),
    warningBright: v('--color-amber-400'),
    warningSubtle: v('--color-amber-950'),
    warningGlow:   'rgba(240,180,41,0.7)',

    // Danger shades — Tailwind red scale
    dangerLight:   v('--color-red-300'),
    dangerSubtle:  v('--color-red-950'),
    dangerCanvas:  v('--color-red-950'),

    // Priority / misc — Tailwind zinc
    priorityMediumBg: v('--color-zinc-800'),

    // Language dot colours — inline, not worth custom tokens
    langPython:     '#3572a5',
    langTypeScript: '#3178c6',
    langGo:         '#00add8',
    langRust:       '#dea584',
    langJavaScript: '#f1e05a',
} as const

export type ColorToken = keyof typeof color
