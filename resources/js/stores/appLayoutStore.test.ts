// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, reactive } from 'vue'
import { PiniaColada, useQueryCache } from '@pinia/colada'
import { playSound } from '@/composables/useAudio'
import { applyTerminalFont, disposeProjectSessions, type Session } from '@/composables/useTerminalSessions'
import { flushPromises } from '@vue/test-utils'
import type { Project } from '@/types/type'
import { useAppLayoutStore } from './appLayoutStore'
import { useProjectStore } from './projectStore'

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({ component: 'Home', props: {} }),
    router: { visit: vi.fn() },
}))

// Real xterm cannot render in happy-dom; the PM session only needs its surface.
vi.mock('@xterm/xterm', () => ({
    Terminal: class {
        cols = 80
        rows = 24
        element?: HTMLElement
        open(el: HTMLElement) { this.element = document.createElement('div'); el.append(this.element) }
        loadAddon() {}
        onData() {}
        onResize() {}
        attachCustomKeyEventHandler() {}
        focus() {}
        write() {}
        dispose() {}
    },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn() }))

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

    it('re-fonts and re-fits live terminals once a saved editor font loads', async () => {
        const { store } = setup()
        const session = fakeSession()
        Object.assign(session.term, { options: {} })
        store.sessions.set(4, session)
        const load = vi.fn(() => Promise.resolve([]))
        Object.defineProperty(document, 'fonts', { value: { load }, configurable: true })

        await applyTerminalFont({ fontFamily: '"JetBrains Mono", monospace', fontSize: 15 })

        expect(load).toHaveBeenCalledWith('15px "JetBrains Mono", monospace')
        expect(session.term.options).toMatchObject({ fontFamily: '"JetBrains Mono", monospace', fontSize: 15 })
        expect(session.fitAddon.fit).toHaveBeenCalled()

        store.sessions.delete(4)
    })

    it('exposes the active project tasks parsed from the JSON:API envelope', async () => {
        vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(url === '/api/projects/7/tasks'
                ? {
                    data: [{ type: 'tasks', id: '4', attributes: { id: 4, project_id: 7, title: 'Ship it', status: 'pending' } }],
                    meta: { total: 1, count: 1, per_page: 15, current_page: 1, last_page: 1, next_page: null, previous_page: null },
                }
                : []),
        })))
        const pinia = createPinia()
        createApp({}).use(pinia).use(PiniaColada)
        setActivePinia(pinia)
        useProjectStore().setActiveProject({ id: 7 } as Project)
        store = useAppLayoutStore()

        await flushPromises()

        expect(store.tasks).toEqual([expect.objectContaining({ id: 4, title: 'Ship it' })])
    })

    it('toggles project search on Cmd+P', () => {
        const { store } = setup()

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true }))
        expect(store.showProjectSearch).toBe(true)

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true }))
        expect(store.showProjectSearch).toBe(false)
    })
})

describe('terminal navigation keys', () => {
    const NAV_KEYS = ['Enter', 'Tab', 'ArrowUp', 'ArrowDown']

    function press(target: Element, key: string) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        target.dispatchEvent(event)
        return event.defaultPrevented
    }

    it('leaves Enter, Tab and arrows alone in form fields and editors', () => {
        setup()
        const form = document.createElement('form')
        const input = document.createElement('input')
        const textarea = document.createElement('textarea')
        const editable = document.createElement('div')
        editable.contentEditable = 'true'
        form.append(input, textarea, editable)
        document.body.append(form)

        for (const target of [input, textarea, editable]) {
            for (const key of NAV_KEYS) {
                expect(press(target, key), `${key} on <${target.tagName.toLowerCase()}>`).toBe(false)
            }
        }
        form.remove()
    })

    it('still blocks them inside a terminal', () => {
        setup()
        const terminal = document.createElement('div')
        terminal.className = 'xterm'
        const helper = document.createElement('textarea')
        terminal.append(helper)
        document.body.append(terminal)

        for (const key of NAV_KEYS) expect(press(helper, key)).toBe(true)
        expect(press(helper, 'a')).toBe(false)
        terminal.remove()
    })
})

describe('agent status pushes', () => {
    type FakeSocket = { onmessage?: (e: { data: unknown }) => void }

    it('refreshes the agent queries when a terminal socket pushes agent_status', async () => {
        const sockets: FakeSocket[] = []
        vi.stubGlobal('WebSocket', class {
            static OPEN = 1
            readyState = 1
            constructor() { sockets.push(this as FakeSocket) }
            send() {}
            close() {}
        })
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
        vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(url === '/api/projects/9/agents'
                ? { data: [{ type: 'agents', id: '3', attributes: { project_id: 9, name: 'PM', agent_type: 'pm', provider: 'claude' } }] }
                : []),
        })))
        const pinia = createPinia()
        createApp({}).use(pinia).use(PiniaColada)
        setActivePinia(pinia)
        useProjectStore().setActiveProject({ id: 9, slug: 'nine' } as Project)
        store = useAppLayoutStore()
        await flushPromises()
        store.setContainer(9, document.createElement('div'))
        await flushPromises()
        expect(sockets).toHaveLength(1)

        const invalidate = vi.spyOn(useQueryCache(), 'invalidateQueries')
        sockets[0].onmessage!({ data: JSON.stringify({ type: 'agent_status', agent_id: 3, status: 'needs_input' }) })

        expect(invalidate).toHaveBeenCalledWith({ key: ['agent-summaries'] })
        expect(invalidate).toHaveBeenCalledWith({ key: ['agents'] })
        expect(playSound).toHaveBeenCalledWith('input')
        disposeProjectSessions(9, [])
    })
})
