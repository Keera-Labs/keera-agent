// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { h, reactive } from 'vue'
import type { ProjectAgent } from '@/queries/agentQuery'
import AgentEditModal from './AgentEditModal.vue'

const page = reactive<{ component: string; props: Record<string, unknown> }>({ component: 'agents/Detail', props: {} })

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => page,
    router: { visit: vi.fn() },
}))

const agent: ProjectAgent = {
    id: 5, project_id: 1, name: 'Dev', slug: 'dev', description: 'Builds things', provider: 'claude',
    model: 'claude-opus-5', system_prompt: 'Be careful.', agent_type: 'software_engineer', status: 'idle',
    flags: { verbose: true }, dangerously_skip_permissions: false, plan_mode: false, created_at: null,
}

type Call = { url: string; method: string; body?: Record<string, unknown> }
let calls: Call[]
let patchResponse: { ok: boolean; body: unknown }

function fakeFetch(url: string, init?: RequestInit) {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined })
    const body = method === 'PATCH' ? patchResponse.body : []
    const ok = method === 'PATCH' ? patchResponse.ok : true
    return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

let wrapper: VueWrapper | undefined

async function openModal() {
    wrapper = mount(AgentEditModal, {
        attachTo: document.body,
        props: { agent },
        global: { plugins: [createPinia(), PiniaColada] },
        slots: { trigger: () => h('button', { id: 'open' }, 'Edit') },
    })
    await flushPromises()
    await wrapper.get('#open').trigger('click')
    await flushPromises()
    return wrapper
}

const field = <T extends HTMLElement>(name: string) => document.querySelector<T>(`[name="${name}"]`)!
const dialog = () => document.querySelector('[role="dialog"]')

async function submit() {
    field<HTMLInputElement>('name').form!.dispatchEvent(new Event('submit'))
    await flushPromises()
}

const patches = () => calls.filter(c => c.method === 'PATCH')

beforeEach(() => {
    calls = []
    patchResponse = { ok: true, body: { data: { type: 'agents', id: '5', attributes: {} } } }
    page.props = {}
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
})

describe('AgentEditModal', () => {
    it('opens prefilled with the agent', async () => {
        await openModal()

        expect(field<HTMLInputElement>('name').value).toBe('Dev')
        expect(field<HTMLInputElement>('description').value).toBe('Builds things')
        expect(field<HTMLSelectElement>('model').value).toBe('claude-opus-5')
        expect(document.querySelector('[title="Toggle --verbose"]')!.getAttribute('aria-pressed')).toBe('true')
    })

    it('saves the edited fields with a single PATCH and closes', async () => {
        await openModal()
        document.querySelectorAll<HTMLButtonElement>('[data-testid="agent-type"]')[0].click()
        document.querySelector<HTMLButtonElement>('[title="Toggle plan mode"]')!.click()
        field<HTMLInputElement>('name').value = '  Lead  '
        field<HTMLInputElement>('name').dispatchEvent(new Event('input'))
        await submit()

        expect(patches()).toHaveLength(1)
        expect(patches()[0]).toMatchObject({
            url: '/api/agents/5',
            body: { name: 'Lead', agent_type: 'pm', plan_mode: true, flags: { verbose: true } },
        })
        expect(dialog()).toBeNull()
    })

    it('resets the model to the first one of a newly picked provider', async () => {
        await openModal()
        const provider = field<HTMLSelectElement>('provider')
        provider.value = 'codex'
        provider.dispatchEvent(new Event('change'))
        await submit()

        expect(patches()[0].body).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna' })
    })

    it('keeps the modal open and shows the server error when saving fails', async () => {
        patchResponse = { ok: false, body: { error: 'Name taken' } }
        await openModal()
        await submit()

        expect(document.body.textContent).toContain('Name taken')
        expect(dialog()).not.toBeNull()
    })
})
