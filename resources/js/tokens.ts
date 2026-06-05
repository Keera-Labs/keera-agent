const v = (name: string) => `var(${name})`

export const color = {
    // ── Custom tokens (light theme) ────────────────────────────────
    canvas:  v('--color-canvas'),   // #f6f8fa
    surface: v('--color-surface'),  // #ffffff
    stroke:  v('--color-stroke'),   // #d0d7de
    accent:  v('--color-accent'),   // #0969da
    success: v('--color-success'),  // #1a7f37
    danger:  v('--color-danger'),   // #cf222e
    overlay: 'rgba(1,4,9,0.4)',

    // ── Aliases (AppLayout inline-style compat) ────────────────────
    bgCanvas:       v('--color-canvas'),
    bgBase:         v('--color-canvas'),
    bgSurface:      v('--color-surface'),
    border:         v('--color-stroke'),
    borderMuted:    v('--color-stroke'),

    // Text — dark text for light backgrounds
    textPrimary:   v('--color-zinc-900'),  // #18181b
    textSecondary: v('--color-zinc-700'),  // #3f3f46
    textTertiary:  v('--color-zinc-600'),  // #52525b
    textMuted:     v('--color-zinc-500'),  // #71717a
    textGhost:     v('--color-zinc-400'),  // #a1a1aa
    textFaint:     v('--color-zinc-400'),  // #a1a1aa

    // Accent shades — blue on light bg
    accentMuted:    v('--color-blue-600'),  // #2563eb
    accentEmphasis: v('--color-blue-600'),  // #2563eb (button bg, avatar bg)
    accentSubtle:   v('--color-blue-50'),   // #eff6ff (active nav/chip bg)
    accentGlow:     'rgba(9,105,218,0.08)',

    // Success shades
    successEmphasis: v('--color-success'),  // #1a7f37
    successBorder:   v('--color-success'),

    // Warning — amber on light bg
    warning:       v('--color-amber-700'),  // #b45309
    warningBright: v('--color-amber-600'),  // #d97706
    warningSubtle: v('--color-amber-100'),  // #fef3c7
    warningGlow:   'rgba(180,83,9,0.15)',

    // Danger shades
    dangerLight:   v('--color-red-600'),   // #dc2626
    dangerSubtle:  v('--color-red-50'),    // #fef2f2
    dangerCanvas:  v('--color-red-50'),    // #fef2f2

    // Priority / misc
    priorityMediumBg: v('--color-amber-50'),  // #fffbeb

    // Language dot colours — inline, not worth custom tokens
    langPython:     '#3572a5',
    langTypeScript: '#3178c6',
    langGo:         '#00add8',
    langRust:       '#ce422b',
    langJavaScript: '#f0d52d',
} as const

export type ColorToken = keyof typeof color
