// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import Detail from './Detail.vue'
import { agentResource, fakeSession, installPinia, project, stubFetch } from './testing'

const page = reactive({ component: 'agents/Detail', props: { agent_id: 11 as number | undefined } })

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => page,
    router: { visit: vi.fn() },
}))

let wrapper: VueWrapper | undefined

async function mountDetail(agentId?: number, builder: Record<string, unknown> = {}) {
    page.props.agent_id = agentId
    const builderResource = agentResource(11, 'Builder')
    Object.assign(builderResource.attributes, builder)
    stubFetch({
        '/api/projects/1/agents': { data: [agentResource(10, 'Planner', 'pm'), builderResource] },
        '/api/workspaces': [{ id: 7, name: 'Labs' }],
    })
    const plugins = installPinia()
    useProjectStore().setActiveProject(project)
    const layout = useAppLayoutStore()
    const holder = document.createElement('div')
    layout.setTerminalHolder(holder)
    wrapper = mount(Detail, {
        global: { plugins: [...plugins], stubs: { PmCheckinControl: true } },
        attachTo: document.body,
    })
    await flushPromises()
    return { wrapper, layout, holder }
}

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('Detail', () => {
    it('shows the project overview when no agent is selected', async () => {
        const { wrapper } = await mountDetail()

        expect(wrapper.find('h1').text()).toBe('Keera')
        expect(wrapper.find('[data-testid="agent-terminal"]').exists()).toBe(false)
    })

    it('renders the selected agent header and terminal slot', async () => {
        const { wrapper } = await mountDetail(11)

        const header = wrapper.find('[data-testid="agent-execution"]').text()
        expect(header).toContain('Builder')
        expect(header).toContain('SOFTWARE ENGINEER')
        expect(wrapper.find('[data-testid="agent-terminal"]').exists()).toBe(true)
    })

    it('pads the xterm rather than its slot, since FitAddon counts slot padding as space', async () => {
        const { wrapper } = await mountDetail(11)

        const slot = wrapper.get('[data-testid="agent-terminal"]')
        expect(slot.classes()).toContain('terminal-host')
        expect(slot.classes().some(c => /^p[xytrbl]?-/.test(c))).toBe(false)
    })

    it('shows no status badge in the header while the agent works', async () => {
        const { wrapper } = await mountDetail(11, { status: 'running' })

        const header = wrapper.get('[data-testid="agent-execution"]')
        expect(header.text()).not.toContain('running')
        expect(header.find('[data-testid="agent-status-indicator"]').exists()).toBe(false)
        expect(header.find('[data-testid="agent-needs-input"]').exists()).toBe(false)
    })

    it('shows no status badge once the project session has stopped', async () => {
        const { wrapper, layout } = await mountDetail(11)
        layout.setClaudeStatus(project.id, 'done')
        await flushPromises()

        const header = wrapper.get('[data-testid="agent-execution"]')
        expect(header.text()).not.toContain('done')
        expect(header.find('[data-testid="agent-status-indicator"]').exists()).toBe(false)
    })

    it('shows the pending permission prompt and focuses the terminal on Reply', async () => {
        const { wrapper } = await mountDetail(11, {
            status: 'needs_input', attention_kind: 'permission', attention_prompt: 'Allow Bash: npm test?',
        })

        const badge = wrapper.get('[data-testid="agent-needs-input"]')
        expect(badge.text()).toContain('Allow Bash: npm test?')
        ;(document.activeElement as HTMLElement | null)?.blur()
        await badge.get('[data-testid="agent-reply"]').trigger('click')

        const helper = wrapper.get('.xterm-helper-textarea').element
        expect(document.activeElement).toBe(helper)
    })

    it('moves a live agent terminal into the slot and parks it on unmount', async () => {
        const session = fakeSession()
        const { wrapper: detail, layout, holder } = await mountDetail(11)
        layout.agentSessions.set(11, session)
        layout.setActiveAgentId(null)
        await flushPromises()
        layout.setActiveAgentId(11)
        await flushPromises()

        const slot = detail.find('[data-testid="agent-terminal"]').element
        expect(session.term.element!.parentElement).toBe(slot)
        expect(layout.agentContainerRefs.get(11)).toBe(slot)

        detail.unmount()
        wrapper = undefined

        expect(session.term.element!.parentElement).toBe(holder)
        expect(layout.agentContainerRefs.get(11)).toBe(holder)
        layout.agentSessions.clear()
    })

    it('registers the slot as the container of an agent without a session', async () => {
        const { wrapper, layout } = await mountDetail()
        vi.spyOn(layout, 'launchAgentSession').mockImplementation(() => {})

        layout.setActiveAgentId(11)
        await flushPromises()

        expect(layout.agentContainerRefs.get(11)).toBe(wrapper.find('[data-testid="agent-terminal"]').element)
    })

    it('shows the PM agent through the project PM session', async () => {
        const { layout } = await mountDetail()
        const showPm = vi.spyOn(layout, 'showPmTerminal')
        const launch = vi.spyOn(layout, 'launchAgentSession')

        layout.setActiveAgentId(10)
        await flushPromises()

        expect(showPm).toHaveBeenCalledWith(1, expect.any(HTMLElement))
        expect(launch).not.toHaveBeenCalled()
    })

    it('returns to the overview from the back button', async () => {
        const { wrapper, layout } = await mountDetail(11)

        await wrapper.find('button[title="Back"]').trigger('click')

        expect(layout.activeAgentId).toBeNull()
        expect(wrapper.find('h1').text()).toBe('Keera')
    })
})
