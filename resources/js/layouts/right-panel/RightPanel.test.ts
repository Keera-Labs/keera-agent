// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { installPinia } from '@/pages/agents/testing'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import RightPanel from './RightPanel.vue'

vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) }, usePage: () => ({ props: {}, component: 'Dashboard' }) }))

beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        const body = url.includes('/files?') ? { path: '', entries: [], truncated: false } : []
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    }))
})

afterEach(() => vi.unstubAllGlobals())

function mountPanel() {
    const wrapper = mount(RightPanel, { global: { plugins: [...installPinia()] } })
    useAppLayoutStore().rightPanelOpen = true
    return wrapper
}

describe('RightPanel', () => {
    it('shows an empty state instead of a blank column when no project is active', async () => {
        const w = mountPanel()
        await flushPromises()
        expect(w.get('[data-testid="right-panel-empty"]').text()).toBe('Select a project to browse files')
    })

    it('shows the active project files in place of the empty state', async () => {
        const w = mountPanel()
        useProjectStore().setActiveProject({ id: 3, name: 'salut-ai', path: '/code/salut-ai' } as Project)
        await flushPromises()
        expect(w.find('[data-testid="right-panel-empty"]').exists()).toBe(false)
        expect(w.text()).toContain('salut-ai')
    })
})
