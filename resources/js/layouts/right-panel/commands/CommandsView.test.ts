// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia, type Pinia } from 'pinia'
import { reactive } from 'vue'
import type { CommandRun } from '@/components/commands/types'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useCommandRunStore } from '@/stores/commandRunStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import CommandOutput from './CommandOutput.vue'
import CommandsView from './CommandsView.vue'

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

const run = (overrides: Partial<CommandRun> = {}): CommandRun => ({
    command_id: 1, worktree: null, status: 'running', exit_code: null, started_at: new Date().toISOString(), ...overrides,
})

let worktreesResponse: () => Promise<Response>
let runs: CommandRun[]
let fetchMock: ReturnType<typeof vi.fn>

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response)
const resource = (r: CommandRun, i = 0) => ({ type: 'command_runs', id: r.id ?? String(i), attributes: r })

function fakeFetch(url: string, init?: RequestInit) {
    const method = init?.method ?? 'GET'
    if (url === '/api/projects/7/git/worktrees') return worktreesResponse()
    if (url === '/api/projects/7/commands' && method === 'POST') {
        const body = JSON.parse(String(init?.body))
        return json({ data: { type: 'commands', id: '2', attributes: { project_id: 7, ...body, kind: 'run', run: null } } })
    }
    if (url === '/api/projects/7/commands') {
        return json({ data: [{ type: 'commands', id: '1', attributes: { project_id: 7, label: 'dev', command: 'npm run dev', kind: 'run', run: null } }] })
    }
    if (url === '/api/projects/7/command-runs' && method === 'POST') {
        const body = JSON.parse(String(init?.body))
        const started = run({ id: 'r9', command_id: null, label: body.command, command: body.command, worktree: body.worktree })
        runs = [started, ...runs]
        return json({ data: resource(started) })
    }
    if (url === '/api/projects/7/command-runs') return json({ data: runs.map(resource) })
    if (url === '/api/commands/1/runs' && method === 'POST') {
        const worktreePath = JSON.parse(String(init?.body)).worktree ?? null
        runs = [...runs.filter(r => r.worktree !== worktreePath), run({ worktree: worktreePath })]
        return json({ data: resource(runs[runs.length - 1]) })
    }
    if (method === 'DELETE') return json(null, 204)
    return json({})
}

const wrappers: VueWrapper[] = []

const viewAgent = (id: number) => (pinia: Pinia) => {
    (useAppLayoutStore(pinia) as unknown as { activeAgentId: number | null }).activeAgentId = id
}
let runStore: ReturnType<typeof useCommandRunStore> | undefined

async function mountViews(setup: (pinia: Pinia) => void = () => {}) {
    const pinia = createPinia()
    useProjectStore(pinia).setActiveProject(project)
    setup(pinia)
    runStore = useCommandRunStore(pinia)
    const options = { attachTo: document.body, global: { plugins: [pinia, PiniaColada] } }
    const commands = mount(CommandsView, { ...options, props: { visible: true } })
    const terminal = mount(CommandOutput, { ...options, props: { visible: true } })
    wrappers.push(commands, terminal)
    await flushPromises()
    return { commands, terminal, pinia }
}

const calls = (url: string, method: string) =>
    fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method)
const postedBodies = () => calls('/api/commands/1/runs', 'POST').map(([, init]) => JSON.parse(init.body))

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

describe('CommandsView', () => {
    it('only counts runs in the viewed worktree as running', async () => {
        runs = [run({ worktree: AGENT_WORKTREE })]
        const { commands } = await mountViews()

        expect(commands.get('[data-testid="commands-place"]').text()).toContain('Runs in root')
        expect(commands.get('[data-testid="saved-run"]').attributes('data-running')).toBe('false')
        expect(commands.find('[data-testid="saved-stop"]').exists()).toBe(false)
    })

    it('offers Stop and Restart on a running saved command without a running card', async () => {
        runs = [run()]
        const { commands } = await mountViews()

        expect(commands.text()).not.toMatch(/running/i)
        expect(commands.get('[data-testid="saved-run"]').attributes('data-running')).toBe('true')
        expect(commands.get('[data-testid="saved-run"]').attributes('aria-label')).toBe('Restart dev')
        expect(commands.get('[data-testid="saved-stop"]').attributes('aria-label')).toBe('Stop dev')
    })

    it('runs in the project root from a non-agent page without leaving the Commands tab', async () => {
        const { commands } = await mountViews()

        await commands.get('[data-testid="saved-run"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([{}])
        expect(FakeWebSocket.instances[0].url).toMatch(/\/acme\/command-ws\/1$/)
        expect(runStore!.outputOpen).toBe(false)
    })

    it('runs in the agent worktree on the agent detail page', async () => {
        page.component = 'agents/Detail'
        const { commands } = await mountViews(viewAgent(3))

        expect(commands.get('[data-testid="commands-place"]').text()).toContain('Runs in agent-3')
        await commands.get('[data-testid="saved-run"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([{ worktree: AGENT_WORKTREE }])
        expect(FakeWebSocket.instances[0].url).toContain(`/acme/command-ws/1?worktree=${encodeURIComponent(AGENT_WORKTREE)}`)
    })

    it('disables Run on the agent detail page while its worktree is loading', async () => {
        worktreesResponse = () => new Promise(() => {})
        page.component = 'agents/Detail'
        const { commands } = await mountViews(viewAgent(3))

        expect(commands.get('[data-testid="commands-place"]').text()).toContain('loading worktree…')
        const button = commands.get('[data-testid="saved-run"]')
        expect(button.attributes('disabled')).toBeDefined()
        await button.trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([])
        expect(runStore!.tabs).toHaveLength(0)
    })

    it('says so instead of running in the root when the agent has no worktree', async () => {
        page.component = 'agents/Detail'
        const { commands } = await mountViews(viewAgent(4))

        expect(commands.get('[data-testid="commands-no-worktree"]').text()).toContain('This agent has no worktree')
        expect(commands.text()).not.toContain('Runs in root')
        expect(commands.get('[data-testid="saved-run"]').attributes('disabled')).toBeDefined()
    })

    it('runs the PM agent in the project root', async () => {
        page.component = 'agents/Detail'
        const { commands } = await mountViews(viewAgent(9))

        await commands.get('[data-testid="saved-run"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toEqual([{}])
    })

    it('follows the page when it navigates away from the agent', async () => {
        page.component = 'agents/Detail'
        const { commands } = await mountViews(viewAgent(3))

        page.component = 'Tasks'
        await flushPromises()

        expect(commands.get('[data-testid="commands-place"]').text()).toContain('Runs in root')
    })

    it('stops a saved run through the API without closing the socket itself', async () => {
        runs = [run()]
        const { commands } = await mountViews()

        await commands.get('[data-testid="saved-stop"]').trigger('click')
        await flushPromises()

        expect(calls('/api/commands/1/runs', 'DELETE')).toHaveLength(1)
    })

    it('stops an ad-hoc run by its id from its output', async () => {
        const { commands, terminal } = await mountViews()

        await commands.get('[data-testid="commands-search"]').setValue('ls -la')
        await commands.get('form').trigger('submit')
        await flushPromises()
        await terminal.get('[data-testid="command-dock-stop"]').trigger('click')
        await flushPromises()

        expect(calls('/api/projects/7/command-runs/r9', 'DELETE')).toHaveLength(1)
    })

    it('opens a saved command\'s output from its row in the Commands tab', async () => {
        runs = [run()]
        const { commands, terminal } = await mountViews()

        await commands.get('[data-testid="saved-output"]').trigger('click')
        await flushPromises()

        expect(runStore!.outputOpen).toBe(true)
        expect(runStore!.activeKey).toBe('1@')
        expect(terminal.get('[data-testid="command-dock-tab"]').text()).toContain('dev')
        expect(postedBodies()).toEqual([])
    })

    it('has no output to open for a command that never ran here', async () => {
        const { commands } = await mountViews()

        expect(commands.get('[data-testid="saved-output"]').attributes('disabled')).toBeDefined()
        expect(commands.find('[data-testid="commands-show-output"]').exists()).toBe(false)
    })

    it('returns to the list and back to the open output', async () => {
        const { commands, terminal } = await mountViews()
        await commands.get('[data-testid="saved-run"]').trigger('click')
        await flushPromises()

        await commands.get('[data-testid="commands-show-output"]').trigger('click')
        expect(runStore!.outputOpen).toBe(true)
        await terminal.get('[data-testid="command-output-back"]').trigger('click')
        expect(runStore!.outputOpen).toBe(false)
        expect(commands.get('[data-testid="commands-show-output"]').text()).toContain('1')
    })

    it('filters saved commands by label or command text', async () => {
        const { commands } = await mountViews()
        const search = commands.get('[data-testid="commands-search"]')

        await search.setValue('RUN DEV')
        expect(commands.findAll('[data-testid="saved-command"]')).toHaveLength(1)

        await search.setValue('pytest')
        expect(commands.findAll('[data-testid="saved-command"]')).toHaveLength(0)
        expect(commands.text()).toContain('No saved command matches')
    })

    it('runs the saved command on Enter when the text names it exactly', async () => {
        const { commands } = await mountViews()
        const search = commands.get('[data-testid="commands-search"]')

        await search.setValue('dev')
        expect(commands.find('[data-testid="commands-adhoc-hint"]').exists()).toBe(false)
        await commands.get('form').trigger('submit')
        await flushPromises()

        expect(postedBodies()).toEqual([{}])
        expect(calls('/api/projects/7/command-runs', 'POST')).toHaveLength(0)
        expect((search.element as HTMLInputElement).value).toBe('')
    })

    it('runs free text once on Enter and attaches to it by run id', async () => {
        const { commands } = await mountViews()

        await commands.get('[data-testid="commands-search"]').setValue('ls -la')
        expect(commands.get('[data-testid="commands-adhoc-hint"]').text()).toContain('ls -la')
        await commands.get('form').trigger('submit')
        await flushPromises()

        const [[, init]] = calls('/api/projects/7/command-runs', 'POST')
        expect(JSON.parse(init.body)).toEqual({ command: 'ls -la', worktree: null })
        expect(FakeWebSocket.instances[0].url).toMatch(/\/acme\/command-run-ws\/r9$/)
        expect(runStore!.outputOpen).toBe(true)
    })

    it('shows the server error when a run is refused', async () => {
        fetchMock.mockImplementation((url: string, init?: RequestInit) =>
            url === '/api/projects/7/command-runs' && init?.method === 'POST'
                ? json({ error: 'Unknown worktree' }, 422)
                : fakeFetch(url, init))
        const { commands } = await mountViews()

        await commands.get('[data-testid="commands-search"]').setValue('ls')
        await commands.get('form').trigger('submit')
        await flushPromises()

        expect(commands.get('[data-testid="commands-error"]').text()).toBe('Unknown worktree')
    })

    it('lists finished runs under Recent with their outcome', async () => {
        const ended = new Date(Date.now() - 5 * 60_000).toISOString()
        runs = [
            run({ id: 'a', status: 'exited', exit_code: 0, ended_at: ended, duration_ms: 4_200 }),
            run({ id: 'b', command_id: null, command: 'pytest', status: 'exited', exit_code: 2, ended_at: ended }),
        ]
        const { commands } = await mountViews()

        const rows = commands.findAll('[data-testid="recent-run"]')
        expect(rows.map(r => r.attributes('data-ok'))).toEqual(['true', 'false'])
        expect(rows[0].text()).toContain('npm run dev')
        expect(rows[0].text()).toContain('4.2s · 5m ago')
        expect(rows[1].text()).toContain('exit 2 · 5m ago')
    })

    it('creates a saved command from + New', async () => {
        const { commands } = await mountViews()

        await commands.get('[data-testid="commands-new"]').trigger('click')
        const [label, command] = commands.findAll('form input').slice(1)
        await label.setValue('Tests')
        await command.setValue('npm test')
        await commands.findAll('form')[1].trigger('submit')
        await flushPromises()

        expect(JSON.parse(calls('/api/projects/7/commands', 'POST')[0][1].body)).toEqual({ label: 'Tests', command: 'npm test' })
        expect(commands.findAll('[data-testid="saved-command"]').map(r => r.text())).toEqual([
            expect.stringContaining('dev'), expect.stringContaining('Tests'),
        ])
    })

    it('deletes a saved command and opens the manager to edit one', async () => {
        const { commands, pinia } = await mountViews()

        await commands.get('button[aria-label="Edit dev"]').trigger('click')
        expect((useAppLayoutStore(pinia) as unknown as { settingsSection: string | null }).settingsSection).toBe('commands')

        await commands.get('button[aria-label="Delete dev"]').trigger('click')
        await flushPromises()

        expect(calls('/api/commands/1', 'DELETE')).toHaveLength(1)
        expect(commands.findAll('[data-testid="saved-command"]')).toHaveLength(0)
    })
})

describe('CommandOutput', () => {
    it('reruns an exited command on a fresh socket', async () => {
        const { commands, terminal } = await mountViews()
        await commands.get('[data-testid="saved-run"]').trigger('click')
        await flushPromises()
        const first = FakeWebSocket.instances[0]

        runs = [run({ status: 'exited', exit_code: 0 })]
        first.onclose?.()
        await flushPromises()
        expect(terminal.find('[data-testid="command-dock-stop"]').exists()).toBe(false)

        await terminal.get('[data-testid="command-dock-rerun"]').trigger('click')
        await flushPromises()

        expect(postedBodies()).toHaveLength(2)
        expect(FakeWebSocket.instances).toHaveLength(2)
        expect(terms).toHaveLength(1)
        expect(terms[0].reset).toHaveBeenCalled()
        expect(terminal.find('[data-testid="command-dock-stop"]').exists()).toBe(true)
    })

    it('reruns a stopped command on a fresh socket', async () => {
        const { commands, terminal } = await mountViews()
        await commands.get('[data-testid="saved-run"]').trigger('click')
        await flushPromises()

        await terminal.get('[data-testid="command-dock-stop"]').trigger('click')
        await flushPromises()
        await terminal.get('[data-testid="command-dock-rerun"]').trigger('click')
        await flushPromises()

        expect(FakeWebSocket.instances).toHaveLength(2)
        expect(FakeWebSocket.instances[0].close).toHaveBeenCalled()
        expect(FakeWebSocket.instances[1].close).not.toHaveBeenCalled()
    })

    it('labels a tab with its command and names the worktree it runs in', async () => {
        page.component = 'agents/Detail'
        const { commands, terminal } = await mountViews(viewAgent(3))

        await commands.get('[data-testid="saved-run"]').trigger('click')
        await flushPromises()

        expect(terminal.get('[data-testid="command-dock-tab"]').text()).toContain('dev')
        expect(terminal.text()).toContain('in agent-3')
    })

    it('says so when the project has no command output', async () => {
        const { terminal } = await mountViews()
        expect(terminal.get('[data-testid="command-output-empty"]').text()).toContain('No command output')
    })

    it('never stops a run when the views unmount', async () => {
        const { commands } = await mountViews()
        await commands.get('[data-testid="saved-run"]').trigger('click')
        await flushPromises()

        wrappers.splice(0).forEach(w => w.unmount())
        await flushPromises()

        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
        expect(FakeWebSocket.instances[0].close).not.toHaveBeenCalled()
        expect(terms[0].dispose).not.toHaveBeenCalled()
    })
})
