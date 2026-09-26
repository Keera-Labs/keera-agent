// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { router } from '@inertiajs/vue3'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import ProjectOverview from './ProjectOverview.vue'
import { agentResource, fakeSession, installPinia, project, stubFetch } from './testing'

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({ component: 'Home', props: {} }),
    router: { visit: vi.fn() },
}))

let wrapper: VueWrapper | undefined

async function mountOverview(
    agents: unknown[] = [agentResource(11, 'Builder'), agentResource(12, 'Checker')],
    routes: Record<string, unknown> = {},
) {
    stubFetch({
        '/api/projects/1/agents': { data: agents },
        '/api/workspaces': [{ id: 7, name: 'Labs' }],
        ...routes,
    })
    const plugins = installPinia()
    useProjectStore().setActiveProject(project)
    wrapper = mount(ProjectOverview, { props: { project }, global: { plugins: [...plugins] }, attachTo: document.body })
    await flushPromises()
    return { wrapper, layout: useAppLayoutStore() }
}

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('ProjectOverview', () => {
    it('shows the project header and one card per agent', async () => {
        const { wrapper } = await mountOverview()

        expect(wrapper.text()).toContain('Labs')
        expect(wrapper.get('h1').text()).toBe('Keera')
        expect(wrapper.text()).toContain('Build agents')
        expect(wrapper.text()).toContain('2 agents')
        expect(wrapper.findAll('article').map(card => card.text())).toEqual([
            expect.stringContaining('Builder'),
            expect.stringContaining('Checker'),
        ])
    })

    it('shows each agent\'s token usage, and a dash when it has none', async () => {
        const tokens = { input: 10, output: 20, cache_creation: 300, cache_read: 1_250_000, total: 1_250_330 }
        const { wrapper } = await mountOverview(undefined, {
            '/api/projects/1/usage': {
                data: { type: 'project_usages', id: '1', attributes: {
                    today: tokens,
                    agents: { 11: { ...tokens, last_model: 'claude-opus-5', last_used_at: null } },
                } },
            },
        })

        const [builder, checker] = wrapper.findAll('article')
        const builderUsage = builder.findAll('span').find(s => s.text() === '1.3M tok')
        expect(builderUsage?.attributes('title')).toContain('Cache read: 1,250,000')
        expect(builderUsage?.attributes('title')).toContain('Last model: claude-opus-5')
        expect(checker.text()).not.toContain('tok')
    })

    it('adds the reported context fill to the usage tooltip', async () => {
        const { wrapper } = await mountOverview(undefined, {
            '/api/projects/1/usage': {
                data: { type: 'project_usages', id: '1', attributes: {
                    today: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
                    agents: {},
                    reports: { 12: {
                        agent_id: 12, model: 'claude-opus-5', five_hour: null, seven_day: null,
                        context_used_percentage: 41.6, context_window_size: 200_000, updated_at: null,
                    } },
                    limits: null,
                } },
            },
        })

        const [builder, checker] = wrapper.findAll('article')
        expect(checker.find('[title="Context: 42% of 200K tok"]').exists()).toBe(true)
        expect(builder.find('[title*="Context"]').exists()).toBe(false)
    })

    it('shows the empty state when the project has no agents', async () => {
        const { wrapper } = await mountOverview([])

        expect(wrapper.findAll('article')).toHaveLength(0)
        expect(wrapper.text()).toContain('No agents yet. Create one to get started.')
    })

    it('shows a loading state until the agents arrive', async () => {
        stubFetch({ '/api/projects/1/agents': () => new Promise(() => {}) })
        const plugins = installPinia()
        wrapper = mount(ProjectOverview, { props: { project }, global: { plugins: [...plugins] } })
        await flushPromises()

        expect(wrapper.text()).toContain('Loading agents…')
    })

    it('marks agents with a live terminal as active', async () => {
        const { wrapper, layout } = await mountOverview()

        layout.agentSessions.set(11, fakeSession())
        layout.agentSessions.set(12, fakeSession())
        layout.disposeAgentSession(12)
        await flushPromises()

        expect(wrapper.get('[data-testid="active-count"]').text()).toBe('1 active')
        expect(wrapper.findAll('[data-testid="agent-status"]').map(s => s.text())).toEqual(['Active', 'Waiting'])
        layout.agentSessions.clear()
    })

    it('shows a working agent with a spinner and a blocked one with its question and Reply', async () => {
        const working = agentResource(11, 'Builder')
        const blocked = agentResource(12, 'Checker')
        Object.assign(working.attributes, { status: 'running' })
        Object.assign(blocked.attributes, { status: 'needs_input', attention_kind: 'question', attention_prompt: 'Squash the commits?' })
        const { wrapper, layout } = await mountOverview([working, blocked])
        layout.agentSessions.set(11, fakeSession())
        layout.agentSessions.set(12, fakeSession())
        layout.agentSessions.set(13, fakeSession())
        layout.disposeAgentSession(13)
        await flushPromises()

        const [workingCard, blockedCard] = wrapper.findAll('article')
        expect(workingCard.get('[data-testid="agent-status"]').text()).toBe('Working')
        expect(workingCard.get('[data-testid="agent-status-indicator"]').attributes('data-status')).toBe('running')
        expect(workingCard.find('[data-testid="agent-card-prompt"]').exists()).toBe(false)

        expect(blockedCard.get('[data-testid="agent-status"]').text()).toContain('Needs input')
        expect(blockedCard.get('[data-testid="agent-card-prompt"]').text()).toContain('Squash the commits?')
        await blockedCard.get('[data-testid="agent-card-reply"]').trigger('click')

        expect(router.visit).toHaveBeenCalledWith('/keera/agents/12')
        layout.agentSessions.clear()
    })

    it('drills into the agent on Open', async () => {
        const { wrapper, layout } = await mountOverview()

        const openButtons = wrapper.findAll('button').filter(b => b.text() === 'Open')
        await openButtons[1].trigger('click')

        expect(layout.activeAgentId).toBe(12)
        expect(router.visit).toHaveBeenCalledWith('/keera/agents/12')
    })

    it('deletes an agent from its card only after confirmation', async () => {
        const { wrapper } = await mountOverview()
        const dialog = () => document.querySelector<HTMLElement>('[data-testid="confirm-delete-agent"]')
        const click = async (testid: string) => {
            document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.click()
            await flushPromises()
        }
        const deleteButtons = wrapper.findAll('[data-testid="agent-card-delete"]')

        await deleteButtons[1].trigger('click')
        await flushPromises()
        expect(dialog()?.textContent).toContain('Delete agent Checker?')
        await click('confirm-delete-agent-cancel')
        expect(dialog()).toBeNull()
        expect(fetch).not.toHaveBeenCalledWith('/api/agents/12', expect.anything())

        await deleteButtons[1].trigger('click')
        await flushPromises()
        await click('confirm-delete-agent-confirm')
        expect(fetch).toHaveBeenCalledWith('/api/agents/12', { method: 'DELETE' })
        expect(dialog()).toBeNull()
    })

    it('opens the add-agent modal from New Agent', async () => {
        const { wrapper } = await mountOverview()

        await wrapper.findAll('button').find(b => b.text() === 'New Agent')!.trigger('click')
        await flushPromises()

        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add Agent')
    })
})
