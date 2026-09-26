// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { reactive } from 'vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import type { AgentTemplate } from '@/types/agent'
import GlobalSettingsModal from './GlobalSettingsModal.vue'

const reload = vi.fn()

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({
        component: 'Home',
        props: {
            global_settings: {
                max_agents_per_project: 4,
                enforce_default_provider: false,
                providers: [{ slug: 'codex', name: 'Codex', models: ['gpt-a', 'gpt-b'] }],
            },
        },
    }),
    router: { visit: vi.fn(), reload: (...args: unknown[]) => reload(...args) },
}))

const builtin: AgentTemplate = {
    id: 1,
    name: 'Engineer',
    description: 'Builds things',
    agent_type: 'software_engineer',
    provider: 'codex',
    model: 'gpt-a',
    system_prompt: 'Build.',
    flags: {},
    plan_mode: false,
    is_builtin: true,
} as AgentTemplate

type Route = { status?: number; body: unknown }
let routes: Record<string, Route>
let fetchMock: ReturnType<typeof vi.fn>

function respond(url: string, init?: RequestInit) {
    const route = routes[`${init?.method ?? 'GET'} ${url}`] ?? { body: [] }
    const status = route.status ?? 200
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(route.body) })
}

function callsTo(method: string, url: string) {
    return fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method)
}

function mountModal() {
    const pinia = createPinia()
    setActivePinia(pinia)
    return mount(GlobalSettingsModal, { global: { plugins: [pinia, PiniaColada] }, attachTo: document.body })
}

function tabButton(wrapper: ReturnType<typeof mountModal>, label: string) {
    return wrapper.findAll('button').find(b => b.text() === label)!
}

beforeEach(() => {
    routes = {
        'GET /api/agent-templates': { body: [builtin] },
        'GET /api/default-permissions': { body: { allow: ['Read'], deny: [] } },
    }
    fetchMock = vi.fn(respond)
    vi.stubGlobal('fetch', fetchMock)
    reload.mockClear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
})

describe('GlobalSettingsModal', () => {
    it('saves general settings and updates the agent limit before the props reload', async () => {
        routes['PATCH /api/global-settings'] = { body: { max_agents_per_project: 7 } }
        const wrapper = mountModal()
        await flushPromises()

        await wrapper.get('input[type="number"]').setValue('7')
        await wrapper.get('input[aria-label="Codex model 2"]').setValue('  ')
        await tabButton(wrapper, 'Save Settings').trigger('click')
        await flushPromises()

        const [[, init]] = callsTo('PATCH', '/api/global-settings')
        expect(JSON.parse(init.body)).toEqual({
            max_agents_per_project: 7,
            enforce_default_provider: false,
            provider_models: { codex: ['gpt-a'] },
        })
        expect(useAppLayoutStore().maxAgentsPerProject).toBe(7)
        expect(reload).toHaveBeenCalledWith({ only: ['global_settings'] })
        expect(wrapper.text()).toContain('Saved ✓')
    })

    it('shows the server error when general settings fail to save', async () => {
        routes['PATCH /api/global-settings'] = { status: 422, body: { error: 'Too many agents' } }
        const wrapper = mountModal()
        await tabButton(wrapper, 'Save Settings').trigger('click')
        await flushPromises()

        expect(wrapper.text()).toContain('Too many agents')
        expect(reload).not.toHaveBeenCalled()
    })

    it('shows built-in templates read-only', async () => {
        const wrapper = mountModal()
        await flushPromises()
        await tabButton(wrapper, 'Templates').trigger('click')

        expect(wrapper.text()).toContain('Select a template to view, or create a new one')
        await wrapper.findAll('button').find(b => b.text().includes('Engineer'))!.trigger('click')

        expect(wrapper.text()).toContain('Built-in templates are read-only.')
        expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
        expect(wrapper.findAll('button').some(b => b.text() === 'Save Changes')).toBe(false)
    })

    it('requires a name and creates a template with the edited flags', async () => {
        routes['POST /api/agent-templates'] = { body: { ...builtin, id: 2, name: 'Reviewer', is_builtin: false } }
        const wrapper = mountModal()
        await flushPromises()
        await tabButton(wrapper, 'Templates').trigger('click')
        await tabButton(wrapper, '+ New Template').trigger('click')

        await tabButton(wrapper, 'Create Template').trigger('click')
        expect(wrapper.text()).toContain('Name is required')
        expect(callsTo('POST', '/api/agent-templates')).toHaveLength(0)

        await wrapper.findAll('label').find(l => l.text().startsWith('Name'))!.get('input').setValue('Reviewer')
        const toggles = wrapper.findAll('button[aria-pressed]')
        await toggles[0].trigger('click')
        await toggles[2].trigger('click')
        await tabButton(wrapper, 'Create Template').trigger('click')
        await flushPromises()

        const [[, init]] = callsTo('POST', '/api/agent-templates')
        expect(JSON.parse(init.body)).toMatchObject({
            name: 'Reviewer',
            provider: 'codex',
            model: 'gpt-a',
            flags: { dangerously_skip_permissions: true },
            plan_mode: true,
        })
        expect(wrapper.text()).toContain('Save Changes')
    })

    it('saves default permissions from the permissions tab', async () => {
        routes['PATCH /api/default-permissions'] = { body: { allow: ['Read'], deny: [] } }
        const wrapper = mountModal()
        await flushPromises()
        await tabButton(wrapper, 'Default Permissions').trigger('click')
        await tabButton(wrapper, 'Save Permissions').trigger('click')
        await flushPromises()

        const [[, init]] = callsTo('PATCH', '/api/default-permissions')
        expect(JSON.parse(init.body)).toEqual({ allow: ['Read'], deny: [] })
        expect(wrapper.text()).toContain('Saved ✓')
    })

    it('closes on the backdrop and the close button but not inside the panel', async () => {
        const wrapper = mountModal()
        await wrapper.get('[role="dialog"]').trigger('click')
        expect(wrapper.emitted('close')).toBeUndefined()

        await wrapper.get('[aria-label="Close"]').trigger('click')
        await wrapper.get('.fixed').trigger('click')
        expect(wrapper.emitted('close')).toHaveLength(2)
    })
})
