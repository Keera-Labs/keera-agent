// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, reactive } from 'vue'
import { PiniaColada } from '@pinia/colada'
import { disposeProjectSessions, type Session } from '@/composables/useTerminalSessions'
import { useAppLayoutStore } from './appLayoutStore'

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({ component: 'Home', props: {} }),
    router: { visit: vi.fn() },
}))

function fakeSession(): Session {
    const element = document.createElement('div')
    return {
        term: { element, focus: vi.fn(), open: vi.fn(), dispose: vi.fn() },
        ws: { close: vi.fn(), readyState: 1 },
        fitAddon: { fit: vi.fn() },
        observer: { observe: vi.fn(), disconnect: vi.fn() },
    } as unknown as Session
}

let store: ReturnType<typeof useAppLayoutStore> | undefined

function setup() {
    const pinia = createPinia()
    createApp({}).use(pinia).use(PiniaColada)
    setActivePinia(pinia)
    store = useAppLayoutStore()
    const holder = document.createElement('div')
    store.setTerminalHolder(holder)
    return { store, holder }
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})

afterEach(() => {
    store?.$dispose()
    store = undefined
    vi.unstubAllGlobals()
})

describe('useAppLayoutStore', () => {
    it('moves a live PM terminal into a visible slot and parks it back without closing the socket', () => {
        const { store, holder } = setup()
        const session = fakeSession()
        store.sessions.set(1, session)
        const slot = document.createElement('div')

        store.showPmTerminal(1, slot)
        expect(session.term.element!.parentElement).toBe(slot)
        expect(session.observer.observe).toHaveBeenCalledWith(slot)
        expect(store.containerRefs.get(1)).toBe(slot)

        store.parkPmTerminal(1)
        expect(session.term.element!.parentElement).toBe(holder)
        expect(store.containerRefs.get(1)).toBe(holder)
        expect(session.ws.close).not.toHaveBeenCalled()

        store.sessions.delete(1)
    })

    it('does not re-register a container for a deleted project', () => {
        const { store } = setup()
        store.sessions.set(3, fakeSession())
        store.showPmTerminal(3, document.createElement('div'))
        disposeProjectSessions(3, [])

        store.parkPmTerminal(3)

        expect(store.containerRefs.has(3)).toBe(false)
    })

    it('keeps the raw session objects out of the store proxy', () => {
        const { store } = setup()
        const session = fakeSession()
        store.sessions.set(2, session)

        expect(store.sessions.get(2)).toBe(session)

        store.sessions.delete(2)
    })

    it('toggles project search on Cmd+P', () => {
        const { store } = setup()

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true }))
        expect(store.showProjectSearch).toBe(true)

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true }))
        expect(store.showProjectSearch).toBe(false)
    })
})
