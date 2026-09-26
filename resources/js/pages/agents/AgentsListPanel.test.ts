// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { router } from '@inertiajs/vue3'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import AgentsListPanel from './AgentsListPanel.vue'
import { agentResource, fakeSession, installPinia, project, stubFetch } from './testing'

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({ component: 'agents/Detail', props: {} }),
    router: { visit: vi.fn() },
}))

let wrapper: VueWrapper | undefined

async function mountPanel() {
    const fetchMock = stubFetch({
        '/api/projects/1/agents': { data: [agentResource(10, 'Planner', 'pm'), agentResource(11, 'Builder')] },
    })
    const plugins = installPinia()
    useProjectStore().setActiveProject(project)
    wrapper = mount(AgentsListPanel, { props: { project }, global: { plugins: [...plugins] } })
    await flushPromises()
    return { wrapper, layout: useAppLayoutStore(), fetchMock }
}

const button = (w: VueWrapper, title: string, index = 0) => w.findAll(`button[title="${title}"]`)[index]

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('AgentsListPanel', () => {
    it('drills into an agent when its row is clicked', async () => {
        const { wrapper, layout } = await mountPanel()

        await wrapper.findAll('[data-testid="agent-row"]')[1].trigger('click')

        expect(layout.activeAgentId).toBe(11)
        expect(router.visit).toHaveBeenCalledWith('/keera/agents/11')
    })

    it('closes the terminal, reselects and deletes when an agent is removed', async () => {
        const { wrapper, layout, fetchMock } = await mountPanel()
        const session = fakeSession()
        layout.agentSessions.set(10, session)
        layout.setActiveAgentId(10)

        await button(wrapper, 'Remove agent', 0).trigger('click')
        await flushPromises()

        expect(session.ws.close).toHaveBeenCalled()
        expect(layout.agentSessions.has(10)).toBe(false)
        expect(layout.activeAgentId).toBe(11)
        expect(fetchMock).toHaveBeenCalledWith('/api/agents/10', { method: 'DELETE' })
        expect(wrapper.findAll('[data-testid="agent-row"]')).toHaveLength(1)
    })

    it('starts every agent except the PM from Start all', async () => {
        const { wrapper, layout } = await mountPanel()
        layout.setActiveAgentId(11)
        const launch = vi.spyOn(layout, 'launchAgentSession')

        await button(wrapper, 'Start all agents').trigger('click')

        expect(launch.mock.calls).toEqual([[11, true]])
    })

    it('does not drill into the agent when its edit button is clicked', async () => {
        const { wrapper, layout } = await mountPanel()

        await button(wrapper, 'Edit agent', 1).trigger('click')

        expect(layout.migratingModal).toBe('Edit agent')
        expect(layout.activeAgentId).toBeNull()
        expect(router.visit).not.toHaveBeenCalled()
    })
})
