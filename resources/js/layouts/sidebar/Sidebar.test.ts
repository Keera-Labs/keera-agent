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
        expect(items[0].classes()).toContain('bg-[#EEF2FF]')
        expect(items[1].classes()).not.toContain('bg-[#EEF2FF]')
        expect(items[1].find('.bg-success').exists()).toBe(true)
        expect(w.text()).toContain('AI Coding Manager')
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
        await w.get('[aria-label="New workspace"]').trigger('click')
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

    it('shows the migration notice for modals that are not ported yet', async () => {
        const w = await mountSidebar()

        await w.get('[title="Add project"]').trigger('click')

        expect(w.get('[role="status"]').text()).toContain('Create project is being migrated')
    })
})
