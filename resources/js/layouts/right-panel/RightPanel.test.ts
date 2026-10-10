// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { installPinia } from '@/pages/agents/testing'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import type { GitBranchChanges, GitWorktree } from '@/queries/gitQuery'
import type { Project } from '@/types/type'
import RightPanel from './RightPanel.vue'
import { gitFile, gitStatus, gitWorktree } from './source-control/testing'

const page = vi.hoisted(() => ({ props: {}, component: 'Dashboard' }))
vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) }, usePage: () => page }))

let branchChanges: GitBranchChanges
let status = gitStatus()
let worktrees: GitWorktree[] = []
let runs: unknown[] = []
const commandRuns = (url: string) => (url.endsWith('/command-runs') ? runs : [])
const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    let body: unknown = []
    if (url.includes('/files?')) body = { path: '', entries: [], truncated: false }
    else if (url.startsWith('/api/projects/3/git/status')) body = status
    else if (url.endsWith('/git/branch-changes')) body = branchChanges
    else if (url.endsWith('/git/branches')) body = { branches: ['dev', 'main'], default_base: 'dev' }
    else if (url.endsWith('/git/pull-request')) body = { available: true, error: null, pull_request: null }
    else if (url.endsWith('/git/worktrees')) body = { worktrees }
    else if (url.endsWith('/git/worktrees/changes')) body = { changes: {} }
    else if (url.endsWith('/command-runs') || url.endsWith('/commands')) body = { data: commandRuns(url) }
    else if (url.endsWith('/api/projects/3/agents')) body = { data: [{ id: 7, attributes: { name: 'Diff Frontend', project_id: 3 } }] }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
})

beforeEach(() => {
    localStorage.clear()
    branchChanges = { base: 'dev', merge_base: 'base', head: 'head', ahead: 0, files: [] }
    status = gitStatus()
    worktrees = []
    runs = []
    page.component = 'Dashboard'
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

function mountPanel() {
    const wrapper = mount(RightPanel, { global: { plugins: [...installPinia()] } })
    useAppLayoutStore().rightPanelOpen = true
    return wrapper
}

const project = { id: 3, name: 'salut-ai', path: '/code/salut-ai' } as Project
const statusCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/git/status')).length
const AGENT_TREE = '/code/salut-ai/.claude/worktrees/agent-7'

describe('RightPanel', () => {
    it('shows an empty state instead of a blank column when no project is active', async () => {
        const w = mountPanel()
        await flushPromises()
        expect(w.get('[data-testid="right-panel-empty"]').text()).toBe('Select a project to see its changes')
        await w.get('[role="tab"][data-view="files"]').trigger('click')
        expect(w.get('[data-testid="right-panel-empty"]').text()).toBe('Select a project to browse files')
    })

    it('hides itself from the toggle in its own toolbar', async () => {
        const w = mountPanel()
        await flushPromises()

        const views = w.get('[data-testid="right-panel-toolbar"]').findAll('[role="tab"]')
        expect(views.map(b => b.text())).toEqual(['Changes', 'Files', 'Terminal', 'Commands', 'Worktrees'])
        expect(views[0]!.attributes('aria-selected')).toBe('true')
        await w.get('[data-testid="toggle-panel-right"]').trigger('click')
        expect(useAppLayoutStore().rightPanelOpen).toBe(false)
    })

    it('opens a worktree from the Worktrees tab in the Changes tab', async () => {
        worktrees = [
            gitWorktree('/code/salut-ai', { is_main: true, is_current: true }),
            gitWorktree(AGENT_TREE, { branch: 'task/2034-diff', agent_id: 7, agent_name: 'Diff Frontend' }),
        ]
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()

        await w.get('[role="tab"][data-view="worktrees"]').trigger('click')
        await flushPromises()
        await w.get('[data-testid="open-worktree"]').trigger('click')
        await flushPromises()

        expect(w.get('[role="tab"][data-view="changes"]').attributes('aria-selected')).toBe('true')
        expect(w.get('[data-testid="worktree-label"]').text()).toBe('Diff Frontend')
    })

    it('shows the active project files in place of the empty state', async () => {
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        expect(w.find('[data-testid="right-panel-empty"]').exists()).toBe(false)
        await w.get('[role="tab"][data-view="files"]').trigger('click')
        await flushPromises()
        expect(w.find('input[aria-label="Go to file"]').exists()).toBe(true)
        expect(w.find('[data-testid="source-control"]').exists()).toBe(false)
    })

    it('marks the Commands tab while a command runs', async () => {
        runs = [{ id: 'r1', type: 'command_runs', attributes: { command_id: 1, label: 'Dev', command: 'npm run dev', worktree: null, status: 'running', exit_code: null, started_at: new Date().toISOString() } }]
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        expect(w.find('[data-testid="commands-running-dot"]').exists()).toBe(true)
        expect(w.get('[role="tab"][data-view="commands"]').attributes('aria-label')).toBe('Commands, running')
    })

    it('badges the Changes tab with the changed file count', async () => {
        status = gitStatus({ count: 5 })
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/3/git/status', { headers: { Accept: 'application/json' } })
        expect(w.get('[data-testid="source-control-badge"]').text()).toBe('5')
        expect(w.get('[role="tab"][data-view="changes"]').attributes('aria-label')).toBe('Changes, 5 changed files')
    })

    it('switches git to the open agent\'s own worktree on its detail page', async () => {
        worktrees = [
            gitWorktree('/code/salut-ai', { is_main: true, is_current: true }),
            gitWorktree(AGENT_TREE, { branch: 'task/7', agent_id: 7, agent_name: 'Diff Frontend' }),
        ]
        page.component = 'agents/Detail'
        mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        useAppLayoutStore().setActiveAgentId(7)
        await flushPromises()

        const agentStatusUrl = `/api/projects/3/git/status?worktree=${encodeURIComponent(AGENT_TREE)}`
        expect(fetchMock).toHaveBeenCalledWith(agentStatusUrl, expect.anything())
        expect(JSON.parse(localStorage.getItem('keera.git.worktree')!)).toEqual({ 3: AGENT_TREE })
    })

    it('keeps the remembered worktree on other pages', async () => {
        worktrees = [
            gitWorktree('/code/salut-ai', { is_main: true, is_current: true }),
            gitWorktree(AGENT_TREE, { agent_id: 7 }),
        ]
        mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        useAppLayoutStore().setActiveAgentId(7)
        await flushPromises()

        expect(fetchMock.mock.calls.some(([url]) => url.includes('worktree='))).toBe(false)
    })

    it('shows no badge on a clean tree', async () => {
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        expect(w.find('[data-testid="source-control-badge"]').exists()).toBe(false)
    })

    it('opens on Changes and reloads it from the refresh icon', async () => {
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        expect(w.find('[data-testid="source-control"]').exists()).toBe(true)

        const before = statusCalls()
        const branchListCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/git/branches')).length
        const branchListsBefore = branchListCalls()
        branchChanges = { ...branchChanges, ahead: 1, files: [gitFile('src/committed.ts')] }
        const refresh = w.get('[data-testid="refresh-source-control"]')
        await refresh.trigger('click')
        expect(refresh.attributes('aria-busy')).toBe('true')
        expect(refresh.get('svg').classes()).toContain('animate-spin')
        await flushPromises()
        expect(refresh.attributes('aria-busy')).toBe('false')
        expect(statusCalls()).toBe(before + 1)
        expect(branchListCalls()).toBe(branchListsBefore + 1)
        expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/git/branch-changes'))).toHaveLength(2)
        expect(w.get('[data-testid="committed-changes"]').text()).toContain('committed.ts')
        expect(fetchMock).toHaveBeenCalledWith('/api/projects/3/git/pull-request', { headers: { Accept: 'application/json' } })
    })
})
