// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { reactive } from 'vue'
import { router } from '@inertiajs/vue3'
import ModalLayer from '@/layouts/ModalLayer.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Project, Workspace } from '@/types/type'
import Sidebar from './Sidebar.vue'

const page = reactive<{ component: string; props: Record<string, unknown> }>({ component: 'Home', props: {} })

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => page,
    router: { visit: vi.fn(), on: vi.fn(() => () => {}) },
}))

function project(id: number, name: string, workspaceId: number | null): Project {
    return {
        id, name, slug: `p-${id}`, path: `/tmp/p-${id}`, language: 'ts',
        workspace_id: workspaceId, claude_status: null, system_prompt: null,
    }
}

const workspaces: Workspace[] = [
    { id: 1, name: 'Alpha', description: null },
    { id: 2, name: 'Empty', description: null },
]
const projects = [project(10, 'alpha-api', 1), project(11, 'alpha-web', 1), project(12, 'loose', null)]

type Call = { url: string; method: string }
let calls: Call[]

function summary(id: number, projectId: number, status: string, extra: Record<string, unknown> = {}) {
    return {
        type: 'agent_summaries',
        id: String(id),
        attributes: {
            project_id: projectId, name: `agent-${id}`, provider: 'claude', agent_type: 'software_engineer',
            status, last_message: null, last_activity_at: null, ...extra,
        },
    }
}
let summaries: ReturnType<typeof summary>[]

function fakeFetch(url: string, init?: RequestInit) {
    calls.push({ url, method: init?.method ?? 'GET' })
    const { pathname, searchParams } = new URL(url, 'http://test')
    let body: unknown = []
    if (pathname === '/api/workspaces') body = workspaces
    if (pathname === '/api/agent-summaries') {
        const ids = searchParams.getAll('project_ids').map(Number)
        body = { data: summaries.filter(s => ids.includes(s.attributes.project_id)) }
    }
    if (pathname === '/api/projects/10/agents') {
        body = { data: summaries.filter(s => s.attributes.project_id === 10) }
    }
    if (pathname === '/api/projects' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(project(99, 'fresh', 1)) })
    }
    if (pathname === '/api/projects') {
        const ws = searchParams.get('workspace_id')
        body = ws === null ? projects : projects.filter(p => p.workspace_id === Number(ws))
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
}

let wrapper: VueWrapper | undefined

async function mountSidebar() {
    const pinia = createPinia()
    wrapper = mount({ components: { Sidebar, ModalLayer }, template: '<Sidebar /><ModalLayer />' }, {
        attachTo: document.body,
        global: { plugins: [pinia, PiniaColada] },
    })
    await flushPromises()
    return wrapper
}

const projectNames = (w: VueWrapper) => w.findAll('[data-testid="project-item"]').map(el => el.text())
const agentNames = (el: { findAll: VueWrapper['findAll'] }) =>
    el.findAll('[data-testid="agent-name"]').map(a => a.text())

beforeEach(() => {
    calls = []
    summaries = []
    page.component = 'Home'
    page.props = {}
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
    localStorage.clear()
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.mocked(router.visit).mockClear()
})

describe('Sidebar', () => {
    it('lists every project under "All Projects" and navigates on select', async () => {
        const w = await mountSidebar()

        expect(projectNames(w)).toEqual(['alpha-api', 'alpha-web', 'loose'])
        expect(w.get('[data-testid="workspace-picker"]').text()).toContain('All Projects')

        await w.findAll('[data-testid="project-item"]')[1].trigger('click')
        expect(router.visit).toHaveBeenCalledWith('/p-11')
    })

    it('scopes the project list to the selected workspace', async () => {
        const w = await mountSidebar()

        await w.get('[data-testid="workspace-picker"]').trigger('click')
        await w.findAll('[data-testid="workspace-option"]')[0].trigger('click')
        await flushPromises()

        expect(useWorkspaceStore().currentWorkspaceId).toBe(1)
        expect(calls.some(c => c.url.includes('workspace_id=1'))).toBe(true)
        expect(projectNames(w)).toEqual(['alpha-api', 'alpha-web'])
        expect(w.get('[data-testid="workspace-picker"]').text()).toContain('Alpha')
        expect(w.get('[data-testid="workspace-menu"]').isVisible()).toBe(false)
    })

    it('shows the empty state for a workspace without projects', async () => {
        const w = await mountSidebar()

        await w.get('[data-testid="workspace-picker"]').trigger('click')
        await w.findAll('[data-testid="workspace-option"]')[1].trigger('click')
        await flushPromises()

        expect(projectNames(w)).toEqual([])
        expect(w.text()).toContain('No projects')
        expect(w.text()).toContain('+ Add project')
    })

    it('highlights the active project and shows its Claude status', async () => {
        const w = await mountSidebar()
        useProjectStore().setActiveProject(projects[0])
        useAppLayoutStore().setClaudeStatus(11, 'done')
        await flushPromises()

        const items = w.findAll('[data-testid="project-item"]')
        expect(items[0].attributes('aria-current')).toBe('page')
        expect(items[0].text()).toContain('/tmp/p-10')
        expect(items[1].attributes('aria-current')).toBeUndefined()
        expect(items[1].get('[data-testid="project-status"]').attributes('data-status')).toBe('done')
        expect(items[2].get('[data-testid="project-status"]').attributes('data-status')).toBe('idle')
    })

    it('confirms before deleting a workspace and falls back to "All Projects"', async () => {
        const w = await mountSidebar()
        useWorkspaceStore().setCurrentWorkspaceId(1)
        await flushPromises()

        await w.get('[data-testid="workspace-picker"]').trigger('click')
        await w.get('[title="Delete workspace"]').trigger('click')

        expect(calls.some(c => c.method === 'DELETE')).toBe(false)
        const dialog = document.querySelector('[aria-label="Delete workspace"]')!
        expect(dialog.textContent).toContain('Alpha')

        ;[...dialog.querySelectorAll('button')].find(b => b.textContent === 'Delete')!.click()
        await flushPromises()

        expect(calls).toContainEqual({ url: '/api/workspaces/1', method: 'DELETE' })
        expect(useWorkspaceStore().currentWorkspaceId).toBeNull()
        expect(document.querySelector('[aria-label="Delete workspace"]')).toBeNull()
    })

    it('creates a workspace from the picker', async () => {
        const w = await mountSidebar()

        await w.get('[data-testid="workspace-picker"]').trigger('click')
        await w.get('[data-testid="workspace-menu"] [aria-label="New workspace"]').trigger('click')
        expect(w.get('[data-testid="workspace-menu"]').isVisible()).toBe(false)

        const input = document.querySelector<HTMLInputElement>('input[name="name"]')!
        input.value = '  Beta  '
        input.dispatchEvent(new Event('input'))
        document.querySelector('form')!.dispatchEvent(new Event('submit'))
        await flushPromises()

        expect(calls).toContainEqual({ url: '/api/workspaces', method: 'POST' })
        const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!
        expect(JSON.parse(post[1]!.body as string)).toEqual({ name: 'Beta' })
        expect(document.querySelector('form')).toBeNull()
    })

    it('creates a project in the selected workspace from "Add project"', async () => {
        const w = await mountSidebar()
        useWorkspaceStore().setCurrentWorkspaceId(1)
        await flushPromises()

        await w.get('[title="Add project"]').trigger('click')
        const dialog = document.querySelector('[role="dialog"]')!
        expect(dialog.textContent).toContain('New Project')
        expect(dialog.querySelector<HTMLSelectElement>('select[name="workspace"]')!.value).toBe('1')

        for (const [field, value] of [['name', 'fresh'], ['path', '~/code/fresh']]) {
            const input = dialog.querySelector<HTMLInputElement>(`input[name="${field}"]`)!
            input.value = value
            input.dispatchEvent(new Event('input'))
        }
        dialog.querySelector('form')!.dispatchEvent(new Event('submit'))
        await flushPromises()

        const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!
        expect(post[0]).toBe('/api/projects')
        expect(JSON.parse(post[1]!.body as string)).toEqual({
            name: 'fresh', path: '~/code/fresh', language: 'Python', workspace_id: 1, create_dir: false,
        })
        expect(router.visit).toHaveBeenCalledWith('/p-99')
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    it('labels the picker without a project count, since the project list is paginated', async () => {
        const w = await mountSidebar()
        const subtitle = () => w.get('[data-testid="workspace-subtitle"]').text()

        expect(subtitle()).toBe('All workspaces')

        await w.get('[data-testid="workspace-picker"]').trigger('click')
        await w.findAll('[data-testid="workspace-option"]')[0].trigger('click')
        await flushPromises()

        expect(subtitle()).toBe('Workspace')
        expect(subtitle()).not.toMatch(/\d/)
    })

    it('opens a project menu upward when it would overflow the list', async () => {
        const w = await mountSidebar()
        const rows = w.findAll('[data-testid="project-item"]').map(el => el.element.parentElement!)
        const scroller = rows[0].closest('.overflow-y-auto')!
        vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ bottom: 400 } as DOMRect)
        vi.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue({ bottom: 40 } as DOMRect)
        vi.spyOn(rows[2], 'getBoundingClientRect').mockReturnValue({ bottom: 390 } as DOMRect)

        async function openMenu(row: HTMLElement) {
            row.dispatchEvent(new MouseEvent('mouseenter'))
            await flushPromises()
            await w.get('[aria-label="Project actions"]').trigger('click')
            const classes = w.get('[data-testid="project-menu"]').classes()
            await w.get('[aria-label="Project actions"]').trigger('click')
            row.dispatchEvent(new MouseEvent('mouseleave'))
            await flushPromises()
            return classes
        }

        expect(await openMenu(rows[0])).toContain('top-full')
        expect(await openMenu(rows[2])).toContain('bottom-full')
    })

    it('keeps a project menu modal open while interacting with it', async () => {
        const w = await mountSidebar()
        const item = w.findAll('[data-testid="project-item"]')[0].element.parentElement!

        item.dispatchEvent(new MouseEvent('mouseenter'))
        await flushPromises()
        await w.get('[aria-label="Project actions"]').trigger('click')
        expect(w.get('[data-testid="project-menu"]').classes()).not.toContain('invisible')
        await w.get('[aria-label="Delete project"]').trigger('click')

        const dialog = document.querySelector('[role="dialog"]')!
        expect(dialog.textContent).toContain('alpha-api')
        expect(w.get('[data-testid="project-menu"]').classes()).toEqual(expect.arrayContaining(['invisible', 'pointer-events-none']))
        dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await flushPromises()
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()

        ;[...dialog.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Delete')!.click()
        await flushPromises()

        expect(calls).toContainEqual({ url: '/api/projects/10', method: 'DELETE' })
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        expect(w.find('[aria-label="Edit project"]').exists()).toBe(false)
    })

    it('creates a workspace from the Workspaces header', async () => {
        const w = await mountSidebar()

        await w.get('[title="New workspace"]').trigger('click')

        expect(document.querySelector('form')!.textContent).toContain('New Workspace')
        expect(w.get('[data-testid="workspace-menu"]').isVisible()).toBe(false)
    })

    it('opens the project search palette from the Search button', async () => {
        const w = await mountSidebar()

        await w.get('[data-testid="sidebar-search"]').trigger('click')
        await flushPromises()

        expect(useAppLayoutStore().showProjectSearch).toBe(true)
        expect(document.querySelector('[aria-label="Search projects"]')).not.toBeNull()
    })

    it('marks Settings as current on the settings page', async () => {
        page.component = 'settings/Index'
        const w = await mountSidebar()

        const settings = w.get('[title="Settings"]')
        expect(settings.attributes('aria-current')).toBe('page')
        await settings.trigger('click')
        expect(router.visit).toHaveBeenCalledWith('/settings')
    })

    it('marks Agents as current only on a project agents page', async () => {
        const w = await mountSidebar()
        useProjectStore().setActiveProject(projects[0])
        const agentsTab = () => w.get('[data-tab="agents"]').attributes('aria-current')

        for (const component of ['Dashboard', 'settings/Index', 'Broadcasting']) {
            page.component = component
            await flushPromises()
            expect(agentsTab(), component).toBeUndefined()
        }

        page.component = 'agents/Detail'
        await flushPromises()
        expect(agentsTab()).toBe('page')
    })

    it('opens the active project from the Agents nav on a non-project page', async () => {
        page.component = 'Dashboard'
        const w = await mountSidebar()
        useProjectStore().setActiveProject(projects[0])
        await flushPromises()

        await w.get('[data-tab="agents"]').trigger('click')
        expect(router.visit).toHaveBeenCalledWith('/p-10')
    })

    it('opens the project search palette from the store', async () => {
        await mountSidebar()

        useAppLayoutStore().showProjectSearch = true
        await flushPromises()

        const dialog = document.querySelector('[aria-label="Search projects"]')!
        expect(dialog.querySelectorAll('[data-testid="search-result"]')).toHaveLength(3)
        dialog.querySelector<HTMLElement>('[data-testid="search-result"]')!.click()
        await flushPromises()

        expect(router.visit).toHaveBeenCalledWith('/p-10')
        expect(document.querySelector('[aria-label="Search projects"]')).toBeNull()
    })

    describe('nested agents', () => {
        it('lists each project\'s agents under it with preview and relative time, in one request', async () => {
            summaries = [
                summary(1, 10, 'waiting', { last_message: 'Fix the login bug', last_activity_at: new Date().toISOString() }),
                summary(2, 12, 'idle', { provider: 'codex' }),
                summary(3, 10, 'idle'),
            ]
            const w = await mountSidebar()

            const cards = w.findAll('[data-testid="project-card"]')
            expect(agentNames(cards[0])).toEqual(['agent-1', 'agent-3'])
            expect(agentNames(cards[1])).toEqual([])
            expect(agentNames(cards[2])).toEqual(['agent-2'])

            const row = cards[0].get('[data-testid="sidebar-agent"]')
            expect(row.attributes('data-status')).toBe('waiting')
            expect(row.text()).toContain('– Fix the login bug')
            expect(row.text()).toContain('now')

            const summaryCalls = calls.filter(c => c.url.startsWith('/api/agent-summaries'))
            expect(summaryCalls).toHaveLength(1)
            expect(summaryCalls[0].url).toBe('/api/agent-summaries?project_ids=10&project_ids=11&project_ids=12')
        })

        it('groups projects with a running agent under "In progress"', async () => {
            summaries = [summary(1, 11, 'running'), summary(2, 10, 'idle')]
            const w = await mountSidebar()

            const inProgress = w.get('[data-testid="group-in-progress"]')
            expect(inProgress.text()).toBe('In progress')
            expect(projectNames(w).map(n => n.replace(/\d+$/, ''))).toEqual(['alpha-web', 'alpha-api', 'loose'])
            const groups = w.findAll('[data-testid^="group-"]').map(g => g.text().trim())
            expect(groups).toEqual(['In progress', 'Projects'])
        })

        it('hides the "In progress" group when nothing is running', async () => {
            summaries = [summary(1, 10, 'waiting')]
            const w = await mountSidebar()

            expect(w.find('[data-testid="group-in-progress"]').exists()).toBe(false)
        })

        it('opens an agent on click and marks it active', async () => {
            vi.stubGlobal('WebSocket', class { close() {} })
            summaries = [summary(1, 10, 'idle'), summary(2, 10, 'idle')]
            const w = await mountSidebar()
            useProjectStore().setActiveProject(projects[0])
            await flushPromises()

            const rows = () => w.findAll('[data-testid="sidebar-agent"]')
            await rows()[1].trigger('click')
            await flushPromises()

            expect(router.visit).toHaveBeenCalledWith('/p-10/agents/2')
            expect(useAppLayoutStore().activeAgentId).toBe(2)
            expect(rows()[1].attributes('aria-current')).toBe('page')
            expect(rows()[0].attributes('aria-current')).toBeUndefined()
        })

        it('collapses a project\'s agents and remembers it', async () => {
            summaries = [summary(1, 10, 'idle'), summary(2, 10, 'idle')]
            const w = await mountSidebar()

            const toggle = w.get('[data-testid="project-collapse"]')
            expect(toggle.text()).toContain('2')
            await toggle.trigger('click')

            expect(w.find('[data-testid="project-agents"]').exists()).toBe(false)
            expect(router.visit).not.toHaveBeenCalled()
            expect(JSON.parse(localStorage.getItem('keera.sidebar.collapsedProjects')!)).toEqual([10])

            wrapper!.unmount()
            const again = await mountSidebar()
            expect(again.find('[data-testid="project-agents"]').exists()).toBe(false)
        })
    })
})
