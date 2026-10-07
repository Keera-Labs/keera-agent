import { computed, onScopeDispose, readonly, ref } from 'vue'

export interface ResizablePanelOptions {
    /** localStorage key the width is saved under, per viewer. */
    storageKey: string
    defaultWidth: number
    /** Which edge of the window the panel sits on; its handle is on the opposite (inner) edge. */
    side: 'left' | 'right'
    minWidth?: number
    maxWidth?: number
    /**
     * Cap as a share of the viewport. Both side panels can be open at their max at
     * once, so this stays well under half to always leave room for the main area.
     */
    maxViewportFraction?: number
}

const KEYBOARD_STEP = 16

export function clampWidth(width: number, min: number, max: number, viewportWidth: number, fraction: number): number {
    const upper = Math.max(min, Math.min(max, Math.floor(viewportWidth * fraction)))
    return Math.round(Math.min(upper, Math.max(min, width)))
}

function loadWidth(key: string, fallback: number): number {
    try {
        const stored = Number(window.localStorage.getItem(key))
        return stored > 0 && Number.isFinite(stored) ? stored : fallback
    } catch {
        return fallback
    }
}

function saveWidth(key: string, width: number | null) {
    try {
        if (width === null) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, String(width))
    } catch { /* storage unavailable: the width stays in memory for this visit */ }
}

/**
 * Drag-to-resize state for a side panel: live width clamped to the viewport,
 * saved per viewer on release, and reset to the default on demand.
 */
export function useResizablePanel(options: ResizablePanelOptions) {
    const {
        storageKey, defaultWidth, side,
        minWidth = 180, maxWidth = 600, maxViewportFraction = 0.35,
    } = options

    const viewportWidth = ref(window.innerWidth)
    const onWindowResize = () => { viewportWidth.value = window.innerWidth }
    window.addEventListener('resize', onWindowResize)

    const clamp = (value: number) => clampWidth(value, minWidth, maxWidth, viewportWidth.value, maxViewportFraction)

    // The stored preference is kept unclamped so shrinking the window and growing it back restores it.
    const preferred = ref(loadWidth(storageKey, defaultWidth))
    const width = computed(() => clamp(preferred.value))
    const isDragging = ref(false)

    const direction = side === 'left' ? 1 : -1
    let startX = 0
    let startWidth = 0
    let restoreBody: (() => void) | null = null

    function onPointerMove(event: PointerEvent) {
        preferred.value = clamp(startWidth + direction * (event.clientX - startX))
    }

    function stopDragging() {
        if (!isDragging.value) return
        isDragging.value = false
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', stopDragging)
        window.removeEventListener('pointercancel', stopDragging)
        restoreBody?.()
        restoreBody = null
        saveWidth(storageKey, preferred.value)
    }

    function startResize(event: PointerEvent) {
        if (event.button !== 0) return
        event.preventDefault()
        startX = event.clientX
        startWidth = width.value
        isDragging.value = true

        // Set on body so the cursor holds and text stays unselected even when the pointer outruns the handle.
        const { userSelect, cursor } = document.body.style
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
        restoreBody = () => Object.assign(document.body.style, { userSelect, cursor })

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', stopDragging)
        window.addEventListener('pointercancel', stopDragging)
    }

    function nudge(delta: number) {
        preferred.value = clamp(width.value + delta)
        saveWidth(storageKey, preferred.value)
    }

    function onKeydown(event: KeyboardEvent) {
        const step = { ArrowRight: KEYBOARD_STEP, ArrowLeft: -KEYBOARD_STEP }[event.key]
        if (step === undefined) return
        event.preventDefault()
        nudge(direction * step)
    }

    function reset() {
        preferred.value = defaultWidth
        saveWidth(storageKey, null)
    }

    onScopeDispose(() => {
        stopDragging()
        window.removeEventListener('resize', onWindowResize)
    })

    return {
        width,
        isDragging: readonly(isDragging),
        startResize,
        onKeydown,
        reset,
    }
}

export type ResizablePanel = ReturnType<typeof useResizablePanel>
