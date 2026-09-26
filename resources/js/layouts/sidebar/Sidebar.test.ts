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
    router: { visit: vi.fn() },
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

function fakeFetch(url: string, init?: RequestInit) {
    calls.push({ url, method: init?.method ?? 'GET' })
    const { pathname, searchParams } = new URL(url, 'http://test')
    let body: unknown = []
    if (pathname === '/api/workspaces') body = workspaces
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

beforeEach(() => {
    calls = []
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
        expect(w.get('[data-testid="workspace-picker"]').text()).toContain('Personal Workspace')

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
})
