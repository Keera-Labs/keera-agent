/**
 * Design token references for use in React inline styles.
 *
 * Values are defined ONCE in resources/css/app.css (@theme block).
 * This file maps human-readable names to var(--color-*) strings so
 * inline styles get IDE autocomplete and compile-time typo checking.
 *
 * Usage:
 *   import { color } from '../tokens'
 *   style={{ background: color.bgCanvas, color: color.textPrimary }}
 */

const v = (name: string) => `var(${name})`

export const color = {
    // ── Backgrounds ───────────────────────────────────────
    bgCanvas:  v('--color-bg-canvas'),   // #010409 — deepest: sidebar, topbar
    bgBase:    v('--color-bg-base'),     // #0d1117 — page background, input fills
    bgSurface: v('--color-bg-surface'),  // #161b22 — cards, modals, active rows
    overlay:   'rgba(0,0,0,0.6)',        // modal backdrop (not a CSS var — always opaque black)

    // ── Borders ───────────────────────────────────────────
    border:      v('--color-border'),        // #21262d — dividers
    borderMuted: v('--color-border-muted'),  // #30363d — input / card borders

    // ── Text ──────────────────────────────────────────────
    textPrimary:   v('--color-text-primary'),    // #e6edf3
    textSecondary: v('--color-text-secondary'),  // #c9d1d9
    textTertiary:  v('--color-text-tertiary'),   // #8b949e
    textMuted:     v('--color-text-muted'),      // #7d8590
    textGhost:     v('--color-text-ghost'),      // #6e7681
    textFaint:     v('--color-text-faint'),      // #484f58 — disabled, placeholders

    // ── Accent (blue) ─────────────────────────────────────
    accent:         v('--color-accent'),          // #58a6ff
    accentMuted:    v('--color-accent-muted'),    // #79c0ff
    accentEmphasis: v('--color-accent-emphasis'), // #1f6feb — selected state
    accentSubtle:   v('--color-accent-subtle'),   // #0d419d — tag backgrounds

    // ── Success (green) ───────────────────────────────────
    success:         v('--color-success'),          // #3fb950
    successEmphasis: v('--color-success-emphasis'), // #238636 — create / submit buttons
    successBorder:   v('--color-success-border'),   // #2ea043

    // ── Warning (yellow) ──────────────────────────────────
    warning:       v('--color-warning'),        // #d29922
    warningBright: v('--color-warning-bright'), // #f0b429 — animated running indicator
    warningSubtle: v('--color-warning-subtle'), // #4a3800 — badge background

    // ── Danger (red) ──────────────────────────────────────
    danger:       v('--color-danger'),        // #ff7b72
    dangerLight:  v('--color-danger-light'),  // #ffa198
    dangerSubtle: v('--color-danger-subtle'), // #67060c — high-priority border
    dangerCanvas: v('--color-danger-canvas'), // #1c1012 — high-priority background

    // ── Priority ──────────────────────────────────────────
    priorityMediumBg: v('--color-priority-medium-bg'), // #1c2128

    // ── Language dot colours ──────────────────────────────
    langPython:     v('--color-lang-python'),     // #3572a5
    langTypeScript: v('--color-lang-typescript'), // #3178c6
    langGo:         v('--color-lang-go'),         // #00add8
    langRust:       v('--color-lang-rust'),        // #dea584
    langJavaScript: v('--color-lang-javascript'), // #f1e05a

    // ── Special effects ───────────────────────────────────
    accentGlow:  'rgba(88, 166, 255, 0.07)', // drag-over overlay tint
    warningGlow: 'rgba(240,180,41,0.7)',     // running indicator glow
} as const

export type ColorToken = keyof typeof color
