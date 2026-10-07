/** 13px is the chrome's main label size, so the default scale is exactly 1 and changes nothing. */
export const DEFAULT_UI_FONT_SIZE = 13
export const MIN_UI_FONT_SIZE = 11
export const MAX_UI_FONT_SIZE = 18

const STORAGE_KEY = 'keera.ui-font-size'

export function clampUiFontSize(size: number): number {
    if (!Number.isFinite(size)) return DEFAULT_UI_FONT_SIZE
    return Math.min(MAX_UI_FONT_SIZE, Math.max(MIN_UI_FONT_SIZE, Math.round(size)))
}

/**
 * Drives every `text-ui-*` utility and the body text through `--ui-scale`, and the
 * sidebar's spacing through `--ui-font-size` (see app.css).
 */
export function applyUiFontSize(size: number): void {
    const clamped = clampUiFontSize(size)
    const root = document.documentElement.style
    root.setProperty('--ui-scale', String(clamped / DEFAULT_UI_FONT_SIZE))
    root.setProperty('--ui-font-size', String(clamped))
}

/**
 * The last size the server confirmed, mirrored locally so it can be applied
 * before the first paint instead of after the settings request returns.
 */
export function readCachedUiFontSize(): number {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw === null ? DEFAULT_UI_FONT_SIZE : clampUiFontSize(Number(raw))
    } catch {
        return DEFAULT_UI_FONT_SIZE
    }
}

export function cacheUiFontSize(size: number): void {
    try {
        localStorage.setItem(STORAGE_KEY, String(size))
    } catch {
        // Storage can be unavailable (private mode); the server value still applies after load.
    }
}
