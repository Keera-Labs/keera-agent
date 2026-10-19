// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia, type Pinia } from 'pinia'
import { reactive } from 'vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import TerminalView from './TerminalView.vue'

const page = reactive({ component: 'Home', props: {} })

vi.mock('@inertiajs/vue3', () => ({ usePage: () => page }))

vi.mock('@/stores/appLayoutStore', async () => {
    const { defineStore } = await import('pinia')
    const { markRaw, ref } = await import('vue')
    return {
        useAppLayoutStore: defineStore('appLayout', () => ({
            activeAgentId: ref<number | null>(null),
            agentHook: markRaw({ agents: ref([{ id: 3, agent_type: 'dev' }, { id: 4, agent_type: 'dev' }]) }),
        })),
    }
})

const terms: { reset: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = []
vi.mock('@/composables/useTerminalSessions', () => ({
    makeTerminal: () => {
        const term = { loadAddon: vi.fn(), onData: vi.fn(), onResize: vi.fn(), reset: vi.fn(), focus: vi.fn(), dispose: vi.fn() }
        terms.push(term)
        return term
    },
    attachTerminal: vi.fn(),
    reportSize: vi.fn(),
    socketMessageHandler: () => () => {},
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

class FakeWebSocket {
    static OPEN = 1
    static instances: FakeWebSocket[] = []
    readyState = 1
    binaryType = ''
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((e: MessageEvent) => void) | null = null
    constructor(public url: string) { FakeWebSocket.instances.push(this) }
    send = vi.fn()
    close = vi.fn()
}

const ROOT = '/repo'
const AGENT_WORKTREE = '/repo/.claude/worktrees/agent-3'
const project = { id: 7, name: 'acme', slug: 'acme', path: ROOT } as Project

const worktree = (path: string, extra: Record<string, unknown> = {}) => ({
    path, branch: path.split('/').pop(), head: null, detached: false, is_main: false, is_current: false,
    locked: false, prunable: false, agent_id: null, agent_name: null, ...extra,
})

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)

const wrappers: VueWrapper[] = []

const viewAgent = (id: number) => (pinia: Pinia) => {
    (useAppLayoutStore(pinia) as unknown as { activeAgentId: number | null }).activeAgentId = id
}

async function mountView(visible = true, setup: (pinia: Pinia) => void = () => {}, pinia = createPinia()) {
    useProjectStore(pinia).setActiveProject(project)
    setup(pinia)
    const view = mount(TerminalView, { attachTo: document.body, props: { visible }, global: { plugins: [pinia, PiniaColada] } })
    wrappers.push(view)
    await flushPromises()
    return { view, pinia }
}

beforeEach(() => {
    terms.length = 0
    FakeWebSocket.instances = []
    page.component = 'Home'
    vi.stubGlobal('fetch', vi.fn((url: string) => json(url.endsWith('/git/worktrees')
        ? { worktrees: [worktree(ROOT, { is_main: true, is_current: true }), worktree(AGENT_WORKTREE, { agent_id: 3 })] }
        : {})))
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
    wrappers.splice(0).forEach(w => w.unmount())
    vi.unstubAllGlobals()
})

describe('TerminalView', () => {
    it('opens a shell in the project root when shown', async () => {
        const { view } = await mountView()

        expect(FakeWebSocket.instances.map(ws => ws.url)).toEqual([expect.stringMatching(/\/acme\/shell-ws$/)])
        expect(view.get('[data-testid="terminal-place"]').text()).toContain('Shell in root')
    })

    it('waits until the tab is shown before starting a shell', async () => {
        const { view } = await mountView(false)
        expect(FakeWebSocket.instances).toHaveLength(0)

        await view.setProps({ visible: true })
        await flushPromises()

        expect(FakeWebSocket.instances).toHaveLength(1)
    })

    it('opens the shell in the agent worktree on the agent detail page', async () => {
        page.component = 'agents/Detail'
        const { view } = await mountView(true, viewAgent(3))

        expect(FakeWebSocket.instances[0].url).toContain(`/acme/shell-ws?worktree=${encodeURIComponent(AGENT_WORKTREE)}`)
        expect(view.get('[data-testid="terminal-place"]').text()).toContain('Shell in agent-3')
    })

    it('opens no shell for an agent without a worktree', async () => {
        page.component = 'agents/Detail'
        const { view } = await mountView(true, viewAgent(4))

        expect(FakeWebSocket.instances).toHaveLength(0)
        expect(view.get('[data-testid="terminal-no-worktree"]').text()).toContain('no worktree')
    })

    it('keeps one shell per worktree across navigation and unmounts', async () => {
        const { view, pinia } = await mountView()
        await view.setProps({ visible: false })
        await view.setProps({ visible: true })
        wrappers.splice(0).forEach(w => w.unmount())
        await mountView(true, () => {}, pinia)

        expect(FakeWebSocket.instances).toHaveLength(1)
        expect(FakeWebSocket.instances[0].close).not.toHaveBeenCalled()
        expect(terms[0].dispose).not.toHaveBeenCalled()
    })

    it('restarts an exited shell on the same terminal', async () => {
        const { view } = await mountView()
        expect(view.find('[data-testid="terminal-restart"]').exists()).toBe(false)

        FakeWebSocket.instances[0].onclose?.()
        await flushPromises()
        await view.get('[data-testid="terminal-restart"]').trigger('click')

        expect(FakeWebSocket.instances).toHaveLength(2)
        expect(terms).toHaveLength(1)
        expect(terms[0].reset).toHaveBeenCalled()
    })
})
