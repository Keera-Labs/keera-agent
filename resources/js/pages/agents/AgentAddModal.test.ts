// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia, setActivePinia } from 'pinia'
import { h, reactive } from 'vue'
import { useProjectStore } from '@/stores/projectStore'
import type { AgentTemplate } from '@/types/agent'
import { modelForProviderComplexity } from '@/types/provider'
import type { Project } from '@/types/type'
import AgentAddModal from './AgentAddModal.vue'

const page = reactive<{ component: string; props: Record<string, unknown> }>({ component: 'agents/Detail', props: {} })

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => page,
    router: { visit: vi.fn() },
}))

const project: Project = {
    id: 1, name: 'api', slug: 'api', path: '/tmp/api', language: 'ts',
    workspace_id: null, claude_status: null, system_prompt: null,
}

function template(overrides: Partial<AgentTemplate>): AgentTemplate {
    return {
        id: 1, name: 'Engineer', description: 'Writes code', agent_type: 'software_engineer',
        system_prompt: 'Ship it.', provider: 'claude', model: 'claude-opus-5', flags: {},
        dangerously_skip_permissions: false, plan_mode: false, is_builtin: true,
        ...overrides,
    }
}

let templates: AgentTemplate[]
let existingAgents: number
let posts: Record<string, unknown>[]

function agentResource(id: number, name: string) {
    return { type: 'agents', id: String(id), attributes: { id, project_id: 1, name, agent_type: 'software_engineer', flags: '{}' } }
}

function fakeFetch(url: string, init?: RequestInit) {
    const method = init?.method ?? 'GET'
    let body: unknown = []
    if (url === '/api/projects/1/agent-templates') body = templates
    if (url === '/api/projects/1/agents' && method === 'GET') {
        body = { data: Array.from({ length: existingAgents }, (_, i) => agentResource(100 + i, `a${i}`)) }
    }
    if (url === '/api/projects/1/agents' && method === 'POST') {
        const payload = JSON.parse(init!.body as string)
        posts.push(payload)
        body = { data: agentResource(7, payload.name) }
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
}

let wrapper: VueWrapper | undefined

async function mountModal({ withProject = true } = {}) {
    const pinia = createPinia()
    setActivePinia(pinia)
    if (withProject) useProjectStore().setActiveProject(project)
    wrapper = mount(AgentAddModal, {
        attachTo: document.body,
        global: { plugins: [pinia, PiniaColada] },
        slots: { trigger: () => h('button', { id: 'open' }, '+ New Agent') },
    })
    await flushPromises()
    return wrapper
}

async function open(w: VueWrapper) {
    await w.get('#open').trigger('click')
    await flushPromises()
}

const field = <T extends HTMLElement>(name: string) => document.querySelector<T>(`[name="${name}"]`)!
const dialog = () => document.querySelector('[role="dialog"]')
const submitButton = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!

async function setValue(name: string, value: string) {
    const el = field<HTMLInputElement | HTMLSelectElement>(name)
    el.value = value
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'))
    await flushPromises()
}

beforeEach(() => {
    templates = []
    existingAgents = 0
    posts = []
    page.props = { global_settings: { default_provider: 'claude', max_agents_per_project: 3 } }
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
})

describe('agent provider complexity model selection', () => {
    it.each([
        ['codex', 'easy', 'gpt-5.6-luna'],
        ['codex', 'medium', 'gpt-5.6-terra'],
        ['codex', 'hard', 'gpt-5.6-sol'],
        ['claude', 'easy', 'claude-sonnet-5'],
        ['claude', 'medium', 'claude-opus-5'],
        ['claude', 'hard', 'claude-fable-5'],
    ])('maps %s %s work to %s', (provider, complexity, model) => {
        expect(modelForProviderComplexity(provider, complexity)).toBe(model)
    })
})

describe('AgentAddModal', () => {
    it('submits the derived Claude model with the provider and complexity, then closes', async () => {
        const w = await mountModal()
        await open(w)

        await setValue('name', 'Reviewer')
        await setValue('complexity', 'hard')
        expect(document.querySelector('output')!.textContent).toBe('claude-fable-5')

        field<HTMLFormElement>('name').form!.dispatchEvent(new Event('submit'))
        await flushPromises()

        expect(posts).toHaveLength(1)
        expect(posts[0]).toMatchObject({ name: 'Reviewer', provider: 'claude', complexity: 'hard', model: 'claude-fable-5' })
        expect(dialog()).toBeNull()
    })

    it('prefills from the builtin engineer template and applies a picked template', async () => {
        templates = [
            template({ id: 1 }),
            template({ id: 2, name: 'Auto QA', agent_type: 'qa', description: 'Tests', system_prompt: 'Test it.', provider: 'codex', plan_mode: true }),
        ]
        const w = await mountModal()
        await open(w)

        expect(field<HTMLInputElement>('description').value).toBe('Writes code')
        expect(field<HTMLTextAreaElement>('system_prompt').value).toBe('Ship it.')

        document.querySelectorAll<HTMLButtonElement>('[data-testid="template-card"]')[1].click()
        await flushPromises()

        expect(field<HTMLInputElement>('description').value).toBe('Tests')
        expect(field<HTMLSelectElement>('provider').value).toBe('codex')
        expect(field<HTMLInputElement>('name').placeholder).toBe('e.g. QA Bot')
        expect(document.querySelector('[title="Toggle plan mode"]')!.getAttribute('aria-pressed')).toBe('true')
    })

    it('blocks submitting once the project is at its agent limit', async () => {
        existingAgents = 3
        const w = await mountModal()
        await open(w)

        expect(document.body.textContent).toContain('Agent limit reached (3/3)')
        expect(submitButton().disabled).toBe(true)
    })

    it('renders an inert trigger without an active project', async () => {
        const w = await mountModal({ withProject: false })
        await open(w)

        expect(w.find('[role="button"]').exists()).toBe(false)
        expect(dialog()).toBeNull()
    })
})
