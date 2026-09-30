export interface Anchor { top: number; bottom: number; right: number }
export interface Size { width: number; height: number }

const GAP = 4
const EDGE = 8

/**
 * Viewport position for a fixed menu anchored under `anchor`'s right edge.
 * It opens below when it fits, otherwise above, and is clamped so it never
 * leaves the viewport. The menu's size is measured, not assumed, because it
 * grows with the UI font size.
 */
export function placeMenu(anchor: Anchor, menu: Size, viewport: Size): { top: number; left: number } {
    const below = anchor.bottom + GAP
    const above = anchor.top - GAP - menu.height
    const fitsBelow = below + menu.height <= viewport.height - EDGE
    const top = fitsBelow ? below : Math.max(EDGE, above)
    const left = Math.min(Math.max(EDGE, anchor.right - menu.width), viewport.width - EDGE - menu.width)
    return { top, left }
}
