// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import { normalizeAgent } from '@/queries/agentQuery'
import AgentCard from './AgentCard.vue'
import ProjectOverview from './ProjectOverview.vue'
import { agentResource, installPinia, project, stubFetch } from './testing'

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({ component: 'Home', props: {} }),
    router: { visit: vi.fn() },
}))

const cloud = { type: 'servers', id: '3', attributes: { name: 'Cloud box', kind: 'cloud', base_url: 'https://cloud.test', has_token: true } }

function handedOff(id: number, name: string) {
    const resource = agentResource(id, name)
    return {
        ...resource,
        attributes: {
            ...resource.attributes,
            status: 'handed_off',
            handed_off_at: '2026-10-22 10:00:00',
            handed_off_to: 'Cloud box (agent #9)',
            handed_off_url: 'https://cloud.test/keera/agents/9',
        },
    }
}

let wrapper: VueWrapper | undefined

async function mountOverview(agents: unknown[], routes: Record<string, unknown> = {}) {
    const fetchMock = stubFetch({ '/api/projects/1/agents': { data: agents }, '/api/servers': { data: [cloud] }, ...routes })
    const plugins = installPinia()
    useProjectStore().setActiveProject(project)
    wrapper = mount(ProjectOverview, { props: { project }, global: { plugins: [...plugins] }, attachTo: document.body })
    await flushPromises()
    return { wrapper, fetchMock, layout: useAppLayoutStore() }
}

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('agent handoff', () => {
    it('pushes an agent to the chosen server after confirmation', async () => {
        vi.stubGlobal('confirm', vi.fn(() => true))
        const { wrapper, fetchMock, layout } = await mountOverview([agentResource(11, 'Builder')], {
            'POST /api/agents/11/handoffs': { data: { type: 'handoffs', id: '1', attributes: { status: 'completed' } } },
        })
        const dispose = vi.spyOn(layout, 'disposeAgentSession')

        await wrapper.get('[data-testid="agent-card-push"]').trigger('click')
        const targets = wrapper.findAll('[data-testid="agent-card-push-target"]')
        expect(targets.map(t => t.text())).toEqual([expect.stringContaining('Push to Cloud box')])
        await targets[0].trigger('click')
        await flushPromises()

        const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/agents/11/handoffs' && init?.method === 'POST')
        expect(call).toBeDefined()
        expect(JSON.parse(call![1]!.body as string)).toEqual({ server_id: 3 })
        expect(dispose).toHaveBeenCalledWith(11)
    })

    it('tells the user when the target runs the agent on another model', async () => {
        vi.stubGlobal('confirm', vi.fn(() => true))
        const alert = vi.fn()
        vi.stubGlobal('alert', alert)
        const notice = 'claude-sonnet-5 is not configured on this server, so the agent runs on claude-opus-5.'
        const { wrapper } = await mountOverview([agentResource(11, 'Builder')], {
            'POST /api/agents/11/handoffs': { data: { type: 'handoffs', id: '1', attributes: { status: 'completed', notice } } },
        })

        await wrapper.get('[data-testid="agent-card-push"]').trigger('click')
        await wrapper.get('[data-testid="agent-card-push-target"]').trigger('click')
        await flushPromises()

        expect(alert).toHaveBeenCalledWith(`Builder moved to Cloud box. ${notice}`)
    })

    it('does nothing when the push is not confirmed', async () => {
        vi.stubGlobal('confirm', vi.fn(() => false))
        const { wrapper, fetchMock } = await mountOverview([agentResource(11, 'Builder')])

        await wrapper.get('[data-testid="agent-card-push"]').trigger('click')
        await wrapper.get('[data-testid="agent-card-push-target"]').trigger('click')
        await flushPromises()

        expect(fetchMock.mock.calls.some(([url]) => url === '/api/agents/11/handoffs')).toBe(false)
    })

    it('reports a failed handoff and keeps the agent', async () => {
        vi.stubGlobal('confirm', vi.fn(() => true))
        const alert = vi.fn()
        vi.stubGlobal('alert', alert)
        const { wrapper, fetchMock, layout } = await mountOverview([agentResource(11, 'Builder')])
        const dispose = vi.spyOn(layout, 'disposeAgentSession')
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
            if (url === '/api/agents/11/handoffs' && init?.method === 'POST') {
                return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'The target server rejected the handoff token.' }) })
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) })
        })

        await wrapper.get('[data-testid="agent-card-push"]').trigger('click')
        await wrapper.get('[data-testid="agent-card-push-target"]').trigger('click')
        await flushPromises()

        expect(alert).toHaveBeenCalledWith('The target server rejected the handoff token.')
        expect(dispose).not.toHaveBeenCalled()
    })

    it('offers to add a server when none are registered', async () => {
        const { wrapper, layout } = await mountOverview([agentResource(11, 'Builder')], { '/api/servers': { data: [] } })
        const openSettings = vi.spyOn(layout, 'openSettings')

        await wrapper.get('[data-testid="agent-card-push"]').trigger('click')
        expect(wrapper.findAll('[data-testid="agent-card-push-target"]')).toHaveLength(0)
        await wrapper.get('[data-testid="agent-card-configure-servers"]').trigger('click')

        expect(openSettings).toHaveBeenCalledWith('servers')
    })

    it('shows where a handed-off agent went instead of its controls', async () => {
        const { wrapper } = await mountOverview([handedOff(11, 'Builder')])

        const card = wrapper.get('article')
        expect(card.get('[data-testid="agent-status"]').text()).toBe('Handed off')
        const link = card.get('[data-testid="agent-card-handed-off"] a')
        expect(link.text()).toBe('Cloud box (agent #9)')
        expect(link.attributes('href')).toBe('https://cloud.test/keera/agents/9')
        expect(card.find('[data-testid="agent-card-push"]').exists()).toBe(false)
        expect(card.find('[title="Restart agent"], [title="Start agent"]').exists()).toBe(false)
        expect(card.find('[data-testid="agent-card-delete"]').exists()).toBe(true)
    })

    it('hides the push action for agents that cannot move', () => {
        const base = normalizeAgent(agentResource(12, 'Lead'))
        const stats = { runtime: '-', provider: 'codex', model: 'm', branch: '-', usage: '-' }
        for (const agent of [{ ...base, provider: 'codex' }, { ...base, agent_type: 'reviewer', provider: 'gemini' }]) {
            const card = mount(AgentCard, {
                props: { agent, running: false, statusLine: null, stats, adoptPending: false, servers: [], handoffPending: false },
                global: { stubs: { AgentEditModal: true, PmCheckinControl: true } },
            })
            expect(card.find('[data-testid="agent-card-push"]').exists()).toBe(false)
            card.unmount()
        }
    })
})
