// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { installPinia } from '@/pages/agents/testing'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import RightPanel from './RightPanel.vue'
import { gitStatus } from './source-control/testing'

vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) }, usePage: () => ({ props: {}, component: 'Dashboard' }) }))

let status = gitStatus()
const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    let body: unknown = []
    if (url.includes('/files?')) body = { path: '', entries: [], truncated: false }
    else if (url.endsWith('/git/status')) body = status
    else if (url.endsWith('/git/pull-request')) body = { available: true, error: null, pull_request: null }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
})

beforeEach(() => {
    localStorage.clear()
    status = gitStatus()
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

describe('RightPanel', () => {
    it('shows an empty state instead of a blank column when no project is active', async () => {
        const w = mountPanel()
        await flushPromises()
        expect(w.get('[data-testid="right-panel-empty"]').text()).toBe('Select a project to browse files')
    })

    it('hides itself from the toggle in its own toolbar', async () => {
        const w = mountPanel()
        await flushPromises()

        const views = w.get('[data-testid="right-panel-toolbar"]').findAll('button[aria-pressed]')
        expect(views.map(b => b.attributes('aria-label'))).toEqual([
            'Files', 'Overview (coming soon)', 'Source control', 'Outline (coming soon)',
        ])
        await w.get('[data-testid="toggle-panel-right"]').trigger('click')
        expect(useAppLayoutStore().rightPanelOpen).toBe(false)
    })

    it('shows the active project files in place of the empty state', async () => {
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        expect(w.find('[data-testid="right-panel-empty"]').exists()).toBe(false)
        expect(w.text()).toContain('salut-ai')
    })

    it('badges the branch icon with the changed file count', async () => {
        status = gitStatus({ count: 5 })
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/3/git/status', { headers: { Accept: 'application/json' } })
        expect(w.get('[data-testid="source-control-badge"]').text()).toBe('5')
        expect(w.get('button[title="Source control"]').attributes('aria-label')).toBe('Source control, 5 changed files')
    })

    it('shows no badge on a clean tree', async () => {
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        expect(w.find('[data-testid="source-control-badge"]').exists()).toBe(false)
    })

    it('opens source control from the branch icon and reloads it from the refresh icon', async () => {
        const w = mountPanel()
        useProjectStore().setActiveProject(project)
        await flushPromises()
        expect(w.find('[data-testid="refresh-source-control"]').exists()).toBe(false)

        await w.get('button[title="Source control"]').trigger('click')
        await flushPromises()
        expect(w.find('[data-testid="source-control"]').exists()).toBe(true)
        expect(w.get('button[title="Source control"]').attributes('aria-pressed')).toBe('true')

        const before = statusCalls()
        await w.get('[data-testid="refresh-source-control"]').trigger('click')
        await flushPromises()
        expect(statusCalls()).toBe(before + 1)
        expect(fetchMock).toHaveBeenCalledWith('/api/projects/3/git/pull-request', { headers: { Accept: 'application/json' } })
    })
})
