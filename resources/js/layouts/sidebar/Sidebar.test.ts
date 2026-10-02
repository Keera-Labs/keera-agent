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
import { applyUiFontSize } from '@/utils/uiFontSize'
import type { Project, Workspace } from '@/types/type'
import { projectColor } from './projectColor'
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
    { id: 1, name: 'Alpha', description: null, claude_config_dir: null },
    { id: 2, name: 'Empty', description: null, claude_config_dir: null },
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
    if (pathname === '/api/workspaces') body = { data: workspaces.map(({ id, ...attributes }) => ({ type: 'workspaces', id: String(id), attributes })) }
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
        expect(w.find('[data-testid="add-project-group"]').exists()).toBe(true)
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

    describe('project menu placement', () => {
        const nativeRect = HTMLElement.prototype.getBoundingClientRect

        // happy-dom does no layout, so the row's position and the menu's rendered
        // size (as measured in the browser) are pinned here.
        async function openMenuAt(rowTop: number, menuSize: { width: number; height: number }) {
            const w = await mountSidebar()
            const row = w.findAll('[data-testid="project-item"]')[0].element.parentElement!
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
                if (this === row) return { top: rowTop, bottom: rowTop + 30, left: 8, right: 208 } as DOMRect
                if (this.dataset.testid === 'project-menu') return { ...menuSize, top: 0, bottom: menuSize.height } as DOMRect
                return nativeRect.call(this)
            })

            row.dispatchEvent(new MouseEvent('mouseenter'))
            await flushPromises()
            await w.get('[aria-label="Project actions"]').trigger('click')
            await flushPromises()
            const style = (w.get('[data-testid="project-menu"]').element as HTMLElement).style
            return { top: parseFloat(style.top), left: parseFloat(style.left), w }
        }

        afterEach(() => {
            vi.restoreAllMocks()
            document.documentElement.removeAttribute('style')
        })

        it('opens below a row with room under it', async () => {
            const { top } = await openMenuAt(40, { width: 180, height: 131 })
            expect(top).toBe(74)
        })

        // Regression: at 18px the menu is 212px tall, so the old fixed 160px guess
        // opened it downward with 170px of room and clipped "Delete project".
        it('opens above when the measured 18px menu does not fit below', async () => {
            applyUiFontSize(18)
            const rowTop = window.innerHeight - 200
            const { top, left } = await openMenuAt(rowTop, { width: 217, height: 212 })
            expect(top).toBe(rowTop - 4 - 212)
            expect(top + 212).toBeLessThanOrEqual(window.innerHeight)
            expect(left).toBeGreaterThanOrEqual(8)
        })

        it('closes on Escape and hands focus back to its trigger', async () => {
            const { w } = await openMenuAt(40, { width: 180, height: 131 })
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
            await flushPromises()
            expect(w.find('[data-testid="project-menu"]').exists()).toBe(false)
            expect(document.activeElement).toBe(w.get('[aria-label="Project actions"]').element)
        })

        it('closes when the list scrolls under it', async () => {
            const { w } = await openMenuAt(40, { width: 180, height: 131 })
            w.find('.overflow-y-auto').element.dispatchEvent(new Event('scroll'))
            await flushPromises()
            expect(w.find('[data-testid="project-menu"]').exists()).toBe(false)
        })
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

    // A narrow footer (e.g. 18px in a 180px sidebar) shows only the icon, named by
    // aria-label and title, rather than clipping the label to "+ N".
    it('names New Agent even when its label collapses to the icon', async () => {
        const w = await mountSidebar()

        const newAgent = w.get('[aria-label="New Agent"]')
        expect(newAgent.attributes('title')).toBe('New Agent')
        expect(newAgent.get('span').classes()).toEqual(expect.arrayContaining(['hidden', '@min-[13.75em]:inline']))
    })

    it('goes to the Dashboard from the logo at the top of the sidebar', async () => {
        const w = await mountSidebar()

        await w.get('[aria-label="Go to Dashboard"]').trigger('click')

        expect(router.visit).toHaveBeenCalledWith('/')
    })

    it('opens the project search palette from the Search button', async () => {
        const w = await mountSidebar()

        await w.get('[data-testid="sidebar-search"]').trigger('click')
        await flushPromises()

        expect(useAppLayoutStore().showProjectSearch).toBe(true)
        expect(document.querySelector('[aria-label="Search projects"]')).not.toBeNull()
    })

    it('opens the Settings modal in place from the gear', async () => {
        const w = await mountSidebar()
        const gear = w.get('[title="Settings"]')
        const dialog = () => w.find('[role="dialog"][aria-label="Settings"]')

        expect(gear.attributes('aria-expanded')).toBe('false')
        await gear.trigger('click')
        await flushPromises()

        expect(dialog().exists()).toBe(true)
        expect(gear.attributes('aria-expanded')).toBe('true')
        expect(router.visit).not.toHaveBeenCalledWith('/settings')

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await flushPromises()
        expect(dialog().exists()).toBe(false)
    })

    it('offers only Tasks in the nav, marked current on the Tasks page', async () => {
        const w = await mountSidebar()
        useProjectStore().setActiveProject(projects[0])
        await flushPromises()

        expect(w.findAll('[data-tab]').map(t => t.attributes('data-tab'))).toEqual(['tasks'])
        expect(w.get('[data-tab="tasks"]').attributes('aria-current')).toBeUndefined()

        page.component = 'Tasks'
        await flushPromises()
        expect(w.get('[data-tab="tasks"]').attributes('aria-current')).toBe('page')

        await w.get('[data-tab="tasks"]').trigger('click')
        expect(router.visit).toHaveBeenCalledWith('/p-10/tasks')
    })

    it('returns from an agent to the project overview from the project row', async () => {
        page.component = 'agents/Detail'
        summaries = [summary(5, 10, 'idle')]
        vi.stubGlobal('WebSocket', class { close() {} })
        const w = await mountSidebar()
        useProjectStore().setActiveProject(projects[0])
        useAppLayoutStore().setActiveAgentId(5)
        await flushPromises()
        expect(useAppLayoutStore().activeAgentId).toBe(5)

        await w.findAll('[data-testid="project-item"]')[0].trigger('click')

        expect(useAppLayoutStore().activeAgentId).toBeNull()
        expect(router.visit).toHaveBeenCalledWith('/p-10')
    })

    it('hides itself and toggles the status bar from its own buttons', async () => {
        const w = await mountSidebar()
        const layout = useAppLayoutStore()

        await w.get('[data-testid="toggle-panel-bottom"]').trigger('click')
        expect(layout.statusBarOpen).toBe(false)
        expect(localStorage.getItem('keera.layout.statusBarOpen')).toBe('false')

        await w.get('[data-testid="toggle-panel-left"]').trigger('click')
        expect(layout.sidebarOpen).toBe(false)
        expect(localStorage.getItem('keera.layout.sidebarOpen')).toBe('false')
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

        it('lists every project in order under one "Projects" heading, running or not', async () => {
            summaries = [summary(1, 11, 'running'), summary(2, 10, 'idle')]
            const w = await mountSidebar()

            expect(w.get('[data-testid="section-projects"]').text().trim()).toBe('Projects')
            expect(w.text()).not.toContain('In progress')
            expect(projectNames(w).map(n => n.replace(/\d+$/, ''))).toEqual(['alpha-api', 'alpha-web', 'loose'])
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

        it('spins the indicator of a working agent', async () => {
            summaries = [summary(1, 10, 'running', { last_message: 'Refactoring' })]
            const w = await mountSidebar()

            const indicator = w.get('[data-testid="sidebar-agent"] [data-testid="agent-status-indicator"]')
            expect(indicator.attributes('data-status')).toBe('running')
            expect(indicator.attributes('aria-label')).toBe('Working')
            expect(w.find('[data-testid="agent-reply"]').exists()).toBe(false)
        })

        it('puts a needs-input agent\'s question in the tooltip with a Reply action that opens the agent', async () => {
            summaries = [summary(1, 10, 'needs_input', {
                last_message: 'Old instruction', attention_kind: 'question', attention_prompt: 'Which port should I use?',
            })]
            const w = await mountSidebar()

            const row = w.get('[data-testid="sidebar-agent"]')
            expect(row.attributes('data-status')).toBe('needs_input')
            expect(row.get('[data-testid="agent-status-indicator"]').attributes('aria-label')).toBe('Needs input')
            expect(row.attributes('title')).toBe('agent-1 — Which port should I use?')
            expect(row.find('[data-testid="agent-preview"]').exists()).toBe(false)

            const reply = w.get('[data-testid="agent-reply"]')
            expect(reply.attributes('aria-label')).toBe('Reply to agent-1')
            expect(reply.attributes('title')).toBe('Reply to agent-1')
            await reply.trigger('click')

            expect(router.visit).toHaveBeenCalledWith('/p-10/agents/1')
        })

        // happy-dom has no container queries, so this pins the markup the browser
        // collapses: in a narrow row the badge drops its label and keeps only the icon,
        // while the name takes all the remaining room instead of sliding under the badge.
        it('lets a needs-input row give the name the room and collapse Reply to an icon', async () => {
            summaries = [summary(1, 10, 'needs_input')]
            const w = await mountSidebar()

            expect(w.get('[data-testid="agent-name"]').classes()).toEqual(expect.arrayContaining(['flex-1', 'min-w-0', 'truncate']))
            const reply = w.get('[data-testid="agent-reply"]')
            expect(reply.classes()).toContain('shrink-0')
            expect(reply.get('svg').classes()).toContain('@min-[10em]:hidden')
            expect(reply.get('span').classes()).toEqual(expect.arrayContaining(['hidden', '@min-[10em]:inline']))
            expect(reply.get('span').text()).toBe('Reply')
        })

        it('describes a permission prompt without text generically', async () => {
            summaries = [summary(1, 10, 'needs_input', { attention_kind: 'permission', attention_prompt: null })]
            const w = await mountSidebar()

            expect(w.get('[data-testid="sidebar-agent"]').attributes('title')).toBe('agent-1 — Waiting for permission')
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

    describe('tab-group styling', () => {
        it('colors each project header and its agent rule from the project id', async () => {
            summaries = [summary(1, 10, 'idle'), summary(2, 11, 'idle')]
            const w = await mountSidebar()

            const cards = w.findAll('[data-testid="project-card"]')
            cards.forEach((card, i) => {
                const color = projectColor(projects[i].id)
                expect(card.attributes('data-color')).toBe(color.name)
                expect(card.get('[data-testid="project-item"]').classes()).toEqual(expect.arrayContaining([color.fill, color.text]))
            })
            expect(cards[0].attributes('data-color')).not.toBe(cards[1].attributes('data-color'))
            expect(cards[0].get('[data-testid="project-agents"]').classes()).toContain(projectColor(10).border)
        })

        it('renders a project without agents as a bare header with no count or chevron', async () => {
            summaries = [summary(1, 10, 'idle')]
            const w = await mountSidebar()

            const card = w.findAll('[data-testid="project-card"]')[1]
            expect(card.get('[data-testid="project-item"]').attributes('aria-current')).toBeUndefined()
            expect(card.get('[title="alpha-web"]').text()).toBe('alpha-web')
            expect(card.find('[data-testid="project-collapse"]').exists()).toBe(false)
            expect(card.find('[data-testid="project-agents"]').exists()).toBe(false)
            expect(card.find('[data-testid="sidebar-agent"]').exists()).toBe(false)
        })

        it('rings only the active project\'s header and keeps the status dot on a solid white backdrop', async () => {
            const w = await mountSidebar()
            useProjectStore().setActiveProject(projects[0])
            await flushPromises()

            const [active, inactive] = w.findAll('[data-testid="project-item"]')
            const ACTIVE_RING = ['ring-2', 'ring-inset', 'ring-black/15']
            expect(active.classes()).toEqual(expect.arrayContaining(ACTIVE_RING))
            ACTIVE_RING.forEach(c => expect(inactive.classes()).not.toContain(c))

            for (const item of [active, inactive]) {
                expect(item.get('[data-testid="project-status"]').classes()).toEqual(expect.arrayContaining(['ring-2', 'ring-white']))
            }
        })

        it('puts the agent count at the right end of the pill, just before the chevron', async () => {
            summaries = [summary(1, 10, 'idle'), summary(2, 10, 'idle')]
            const w = await mountSidebar()
            useProjectStore().setActiveProject(projects[0])
            await flushPromises()

            const header = w.findAll('[data-testid="project-item"]')[0].element
            const toggle = w.get('[data-testid="project-collapse"]').element
            // A direct child of the pill row, after the stretching name column, so it is right-aligned
            // and vertically centred even when the active project's path line shows.
            expect(toggle.parentElement).toBe(header)
            expect(header.lastElementChild).toBe(toggle)
            expect(header.querySelector('[title="alpha-api"]')!.parentElement!.classList).toContain('flex-1')
            expect(toggle.textContent!.trim()).toBe('2')
            expect(toggle.lastElementChild!.tagName.toLowerCase()).toBe('svg')
        })

        it('flips the chevron when a group collapses', async () => {
            summaries = [summary(1, 10, 'idle')]
            const w = await mountSidebar()

            const chevron = () => w.get('[data-testid="project-collapse"] svg')
            expect(chevron().classes()).toContain('rotate-180')
            await w.get('[data-testid="project-collapse"]').trigger('click')
            expect(chevron().classes()).not.toContain('rotate-180')
            expect(w.get('[data-testid="project-collapse"]').attributes('aria-expanded')).toBe('false')
        })

        it('opens the new-project dialog from the "+" button below the groups', async () => {
            const w = await mountSidebar()

            const list = w.get('[data-testid="add-project-group"]').element.closest('ul')!
            expect(list.lastElementChild!.contains(w.get('[data-testid="add-project-group"]').element)).toBe(true)
            await w.get('[data-testid="add-project-group"]').trigger('click')
            expect(document.querySelector('[role="dialog"]')!.textContent).toContain('New Project')
        })
    })
})
