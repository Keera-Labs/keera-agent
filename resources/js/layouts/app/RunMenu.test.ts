// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia, type Pinia } from 'pinia'
import { reactive } from 'vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useCommandRunStore } from '@/stores/commandRunStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import CommandDock from './CommandDock.vue'
import RunMenu from './RunMenu.vue'

const page = reactive({ component: 'Home', props: {} })

vi.mock('@inertiajs/vue3', () => ({ usePage: () => page }))

vi.mock('@/stores/appLayoutStore', async () => {
    const { defineStore } = await import('pinia')
    const { markRaw, ref } = await import('vue')
    return {
        useAppLayoutStore: defineStore('appLayout', () => ({
            activeAgentId: ref<number | null>(null),
            settingsSection: ref<string | null>(null),
            agentHook: markRaw({
                agents: ref([
                    { id: 3, agent_type: 'dev' },
                    { id: 4, agent_type: 'dev' },
                    { id: 9, agent_type: 'pm' },
                ]),
            }),
        })),
    }
})

const terms: { reset: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = []
vi.mock('@/composables/useTerminalSessions', () => ({
    makeTerminal: () => {
        const term = { loadAddon: vi.fn(), onData: vi.fn(), onResize: vi.fn(), reset: vi.fn(), clear: vi.fn(), focus: vi.fn(), dispose: vi.fn() }
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

let worktreesResponse: () => Promise<Response>
let runs: { command_id: number | null; worktree: string | null; status: string; exit_code: number | null }[]
let fetchMock: ReturnType<typeof vi.fn>

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response)

function fakeFetch(url: string, init?: RequestInit) {
    const method = init?.method ?? 'GET'
    if (url === '/api/projects/7/git/worktrees') return worktreesResponse()
    if (url === '/api/projects/7/commands') {
        return json({ data: [{ type: 'commands', id: '1', attributes: { project_id: 7, label: 'dev', command: 'npm run dev', kind: 'run', run: null } }] })
    }
    if (url === '/api/projects/7/command-runs') {
        return json({ data: runs.map((attributes, i) => ({ type: 'command_runs', id: String(i), attributes })) })
    }
    if (url === '/api/commands/1/runs' && method === 'POST') {
        const worktreePath = JSON.parse(String(init?.body)).worktree ?? null
        runs = [...runs.filter(r => r.worktree !== worktreePath), { command_id: 1, worktree: worktreePath, status: 'running', exit_code: null }]
        return json({ data: { type: 'command_runs', id: 'x', attributes: runs[runs.length - 1] } })
    }
    if (url.startsWith('/api/commands/1/runs') && method === 'DELETE') return json(null, 204)
    return json({})
}

const wrappers: VueWrapper[] = []

const viewAgent = (id: number) => (pinia: Pinia) => {
    (useAppLayoutStore(pinia) as unknown as { activeAgentId: number | null }).activeAgentId = id
}
let runStore: ReturnType<typeof useCommandRunStore> | undefined

async function mountMenu(setup: (pinia: Pinia) => void = () => {}) {
    const pinia = createPinia()
    useProjectStore(pinia).setActiveProject(project)
    setup(pinia)
    runStore = useCommandRunStore(pinia)
    const options = { attachTo: document.body, global: { plugins: [pinia, PiniaColada] } }
    const menu = mount(RunMenu, options)
    const dock = mount(CommandDock, options)
    wrappers.push(menu, dock)
    await flushPromises()
    await menu.get('[data-testid="run-menu-button"]').trigger('click')
    await flushPromises()
    return { menu, dock }
}

const postedBodies = () =>
    fetchMock.mock.calls.filter(([url, init]) => url === '/api/commands/1/runs' && init?.method === 'POST').map(([, init]) => JSON.parse(init.body))

beforeEach(() => {
    runs = []
    worktreesResponse = () =>
        json({ worktrees: [worktree(ROOT, { is_main: true, is_current: true }), worktree(AGENT_WORKTREE, { agent_id: 3, agent_name: 'Dev' })] })
    terms.length = 0
    FakeWebSocket.instances = []
    page.component = 'Home'
    fetchMock = vi.fn(fakeFetch)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
    wrappers.splice(0).forEach(w => w.unmount())
    runStore?.tabs.map(t => t.key).forEach(key => runStore!.closeTab(key))
    vi.unstubAllGlobals()
})

describe('RunMenu', () => {
    it('shows the run status of the viewed worktree from /command-runs', async () => {
        runs = [{ command_id: 1, worktree: AGENT_WORKTREE, status: 'running', exit_code: null }]
        const { menu } = await mountMenu()

        expect(menu.text()).toContain('in: root')
        expect(menu.get('[data-status]').attributes('data-status')).toBe('idle')
        expect(menu.find('button[title="Run"]').exists()).toBe(true)

        runs = [{ command_id: 1, worktree: null, status: 'running', exit_code: null }]
        await menu.get('[data-testid="run-menu-button"]').trigger('click')
        await menu.get('[data-testid="run-menu-button"]').trigger('click')
        await flushPromises()

        expect(menu.get('[data-status]').attributes('data-status')).toBe('running')
        expect(menu.find('button[title="Stop"]').exists()).toBe(true)
        expect(menu.find('button[title="Rerun"]').exists()).toBe(true)
    })

    it('shows the newest run when /command-runs also lists history and ad-hoc runs', async () => {
        runs = [
            { command_id: null, worktree: null, status: 'running', exit_code: null },
            { command_id: 1, worktree: null, status: 'exited', exit_code: 0 },
            { command_id: 1, worktree: null, status: 'stopped', exit_code: null },
        ]
        const { menu } = await mountMenu()

        expect(menu.get('[data-status]').attributes('data-status')).toBe('exited')
    })

    it('runs in the project root from a non-agent page', async () => {
        const { menu } = await mountMenu()

        await menu.get('button[title="Run"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([{}])
        expect(FakeWebSocket.instances[0].url).toMatch(/\/acme\/command-ws\/1$/)
    })

    it('runs in the agent worktree on the agent detail page', async () => {
        page.component = 'agents/Detail'
        const { menu } = await mountMenu(viewAgent(3))

        expect(menu.text()).toContain('in: agent-3')
        await menu.get('button[title="Run"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([{ worktree: AGENT_WORKTREE }])
        expect(FakeWebSocket.instances[0].url).toContain(`/acme/command-ws/1?worktree=${encodeURIComponent(AGENT_WORKTREE)}`)
    })

    it('disables Run on the agent detail page while its worktree is loading', async () => {
        worktreesResponse = () => new Promise(() => {})
        page.component = 'agents/Detail'
        const { menu } = await mountMenu(viewAgent(3))

        expect(menu.text()).toContain('in: loading worktree…')
        const run = menu.get('button[title="Run"]')
        expect(run.attributes('disabled')).toBeDefined()
        await run.trigger('click')
        await menu.get('[data-testid="run-menu-row"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([])
        expect(runStore!.tabs).toHaveLength(0)
    })

    it('says so instead of running in the root when the agent has no worktree', async () => {
        page.component = 'agents/Detail'
        const { menu } = await mountMenu(viewAgent(4))

        expect(menu.get('[data-testid="run-menu-no-worktree"]').text()).toContain('This agent has no worktree')
        expect(menu.text()).not.toContain('in: root')
        const run = menu.get('button[title="Run"]')
        expect(run.attributes('disabled')).toBeDefined()
        await run.trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([])
    })

    it('runs the PM agent in the project root', async () => {
        page.component = 'agents/Detail'
        const { menu } = await mountMenu(viewAgent(9))

        expect(menu.text()).toContain('in: root')
        await menu.get('button[title="Run"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([{}])
    })

    it('follows the page when it navigates away from the agent', async () => {
        page.component = 'agents/Detail'
        const { menu } = await mountMenu(viewAgent(3))

        page.component = 'Tasks'
        await flushPromises()

        expect(menu.text()).toContain('in: root')
    })

    it('stops through the API without closing the socket itself', async () => {
        runs = [{ command_id: 1, worktree: null, status: 'running', exit_code: null }]
        const { menu } = await mountMenu()

        await menu.get('button[title="Stop"]').trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/commands/1/runs', expect.objectContaining({ method: 'DELETE' }))
    })
})

describe('CommandDock', () => {
    it('reruns an exited command on a fresh socket', async () => {
        const { menu, dock } = await mountMenu()
        await menu.get('button[title="Run"]').trigger('click')
        await flushPromises()
        const first = FakeWebSocket.instances[0]

        runs = [{ command_id: 1, worktree: null, status: 'exited', exit_code: 0 }]
        first.onclose?.()
        await flushPromises()
        expect(dock.find('[data-testid="command-dock-stop"]').exists()).toBe(false)

        await dock.get('[data-testid="command-dock-rerun"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toHaveLength(2)
        expect(FakeWebSocket.instances).toHaveLength(2)
        expect(terms).toHaveLength(1)
        expect(terms[0].reset).toHaveBeenCalled()
        expect(dock.find('[data-testid="command-dock-stop"]').exists()).toBe(true)
    })

    it('reruns a stopped command on a fresh socket', async () => {
        const { menu, dock } = await mountMenu()
        await menu.get('button[title="Run"]').trigger('click')
        await flushPromises()

        await dock.get('[data-testid="command-dock-stop"]').trigger('click')
        await flushPromises()
        await dock.get('[data-testid="command-dock-rerun"]').trigger('click')
        await flushPromises()

        expect(FakeWebSocket.instances).toHaveLength(2)
        expect(FakeWebSocket.instances[0].close).toHaveBeenCalled()
        expect(FakeWebSocket.instances[1].close).not.toHaveBeenCalled()
    })

    it('labels a tab with its command and worktree', async () => {
        page.component = 'agents/Detail'
        const { menu, dock } = await mountMenu(viewAgent(3))

        await menu.get('button[title="Run"]').trigger('click')
        await flushPromises()

        expect(dock.get('[data-testid="command-dock-tab"]').text()).toContain('dev @ agent-3')
    })

    it('never stops a run when the menu and dock unmount', async () => {
        const { menu } = await mountMenu()
        await menu.get('button[title="Run"]').trigger('click')
        await flushPromises()

        wrappers.splice(0).forEach(w => w.unmount())
        await flushPromises()

        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
        expect(FakeWebSocket.instances[0].close).not.toHaveBeenCalled()
        expect(terms[0].dispose).not.toHaveBeenCalled()
    })
})
