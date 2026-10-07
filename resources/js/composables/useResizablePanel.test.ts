// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, effectScope, h, nextTick } from 'vue'
import ResizeHandle from '@/components/ui/ResizeHandle.vue'
import { clampWidth, useResizablePanel, type ResizablePanelOptions } from './useResizablePanel'

const KEY = 'test.panelWidth'

function setViewport(width: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    window.dispatchEvent(new Event('resize'))
}

function pointer(type: string, clientX: number, target: EventTarget = window) {
    target.dispatchEvent(new PointerEvent(type, { clientX, button: 0, bubbles: true }))
}

const scopes: ReturnType<typeof effectScope>[] = []
function panel(options: Partial<ResizablePanelOptions> = {}) {
    const scope = effectScope()
    scopes.push(scope)
    return scope.run(() => useResizablePanel({ storageKey: KEY, defaultWidth: 240, side: 'left', ...options }))!
}

function drag(p: ReturnType<typeof panel>, from: number, to: number) {
    p.startResize(new PointerEvent('pointerdown', { clientX: from, button: 0 }))
    pointer('pointermove', to)
    pointer('pointerup', to)
}

beforeEach(() => {
    localStorage.clear()
    setViewport(1600)
})

afterEach(() => {
    scopes.splice(0).forEach(scope => scope.stop())
    vi.restoreAllMocks()
})

describe('clampWidth', () => {
    it.each([
        [100, 180],
        [300, 300],
        [900, 560],
    ])('clamps %i to %i within [180, min(600, 35% of 1600)]', (width, expected) => {
        expect(clampWidth(width, 180, 600, 1600, 0.35)).toBe(expected)
    })

    it('never goes below the minimum on a tiny viewport', () => {
        expect(clampWidth(400, 180, 600, 300, 0.35)).toBe(180)
    })
})

describe('useResizablePanel', () => {
    it('starts at the default width', () => {
        expect(panel().width.value).toBe(240)
    })

    it('widens a left panel when dragged right and a right panel when dragged left', () => {
        const left = panel()
        drag(left, 500, 560)
        expect(left.width.value).toBe(300)

        const right = panel({ storageKey: 'test.right', side: 'right' })
        drag(right, 500, 440)
        expect(right.width.value).toBe(300)
    })

    it('resizes live while dragging and clamps past min and max', () => {
        const p = panel()
        p.startResize(new PointerEvent('pointerdown', { clientX: 500, button: 0 }))
        expect(p.isDragging.value).toBe(true)

        pointer('pointermove', 100)
        expect(p.width.value).toBe(180)
        pointer('pointermove', 2000)
        expect(p.width.value).toBe(560)

        pointer('pointerup', 2000)
        expect(p.isDragging.value).toBe(false)
    })

    it('suppresses text selection only while dragging', () => {
        const p = panel()
        p.startResize(new PointerEvent('pointerdown', { clientX: 0, button: 0 }))
        expect(document.body.style.userSelect).toBe('none')
        expect(document.body.style.cursor).toBe('col-resize')

        pointer('pointerup', 0)
        expect(document.body.style.userSelect).toBe('')
        expect(document.body.style.cursor).toBe('')
    })

    it('ignores non-primary buttons', () => {
        const p = panel()
        p.startResize(new PointerEvent('pointerdown', { clientX: 0, button: 2 }))
        expect(p.isDragging.value).toBe(false)
    })

    it('persists the width on release and restores it on the next load', () => {
        drag(panel(), 500, 580)
        expect(localStorage.getItem(KEY)).toBe('320')
        expect(panel().width.value).toBe(320)
    })

    it('reset returns to the default and forgets the saved width', () => {
        const p = panel()
        drag(p, 500, 580)
        p.reset()
        expect(p.width.value).toBe(240)
        expect(localStorage.getItem(KEY)).toBeNull()
    })

    it('falls back to the default for corrupt stored values', () => {
        localStorage.setItem(KEY, 'wide')
        expect(panel().width.value).toBe(240)
    })

    it('keeps working in memory when localStorage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })

        const p = panel()
        expect(p.width.value).toBe(240)
        drag(p, 500, 560)
        expect(p.width.value).toBe(300)
        expect(() => p.reset()).not.toThrow()
        expect(p.width.value).toBe(240)
    })

    it('shrinks with the window and restores the saved width when it grows back', () => {
        localStorage.setItem(KEY, '500')
        const p = panel()
        expect(p.width.value).toBe(500)

        setViewport(800)
        expect(p.width.value).toBe(280)

        setViewport(1600)
        expect(p.width.value).toBe(500)
    })

    it('nudges with the arrow keys toward the main area', () => {
        const p = panel({ side: 'right' })
        p.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
        expect(p.width.value).toBe(256)
        expect(localStorage.getItem(KEY)).toBe('256')
    })

    it('stops listening once its scope is disposed', () => {
        const p = panel()
        p.startResize(new PointerEvent('pointerdown', { clientX: 500, button: 0 }))
        scopes.splice(0).forEach(scope => scope.stop())

        pointer('pointermove', 600)
        expect(p.width.value).toBe(240)
        expect(document.body.style.userSelect).toBe('')
    })
})

describe('ResizeHandle', () => {
    function mountHandle() {
        let p!: ReturnType<typeof useResizablePanel>
        const wrapper = mount(defineComponent({
            setup() {
                p = useResizablePanel({ storageKey: KEY, defaultWidth: 240, side: 'left' })
                return () => h(ResizeHandle, { panel: p, label: 'Resize sidebar' })
            },
        }))
        return { wrapper, handle: wrapper.get('[data-testid="resize-handle"]'), p: () => p }
    }

    it('is a labelled vertical separator reporting the width', () => {
        const { handle } = mountHandle()
        expect(handle.attributes('role')).toBe('separator')
        expect(handle.attributes('aria-label')).toBe('Resize sidebar')
        expect(handle.attributes('aria-valuenow')).toBe('240')
        expect(handle.classes()).toContain('cursor-col-resize')
    })

    it('drags from the handle and resets on double-click', async () => {
        const { handle, p, wrapper } = mountHandle()
        pointer('pointerdown', 500, handle.element)
        await nextTick()
        expect(handle.attributes('data-dragging')).toBeDefined()

        pointer('pointermove', 600)
        pointer('pointerup', 600)
        await nextTick()
        expect(p().width.value).toBe(340)
        expect(handle.attributes('data-dragging')).toBeUndefined()

        await handle.trigger('dblclick')
        expect(p().width.value).toBe(240)
        wrapper.unmount()
    })
})
