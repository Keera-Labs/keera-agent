// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { reactive } from 'vue'
import type { AgentTemplate } from '@/types/agent'
import TemplatesTab from './TemplatesTab.vue'

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({ props: {} }),
}))

const template = (overrides: Partial<AgentTemplate> = {}): AgentTemplate => ({
    id: 1, name: 'Engineer', description: null, agent_type: 'software_engineer', system_prompt: 'Be good',
    provider: 'codex', model: 'gpt-5.6-terra', flags: {}, dangerously_skip_permissions: false,
    plan_mode: false, is_builtin: false, ...overrides,
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        let body: unknown = [template(), template({ id: 2, name: 'Planner', agent_type: 'pm', is_builtin: true })]
        if (method === 'POST' && url === '/api/agent-templates') body = { ...JSON.parse(init!.body as string), id: 3, is_builtin: false }
        if (method === 'PATCH') body = { ...template(), ...JSON.parse(init!.body as string) }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    })
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

async function mountTab() {
    const w = mount(TemplatesTab, { global: { plugins: [createPinia(), PiniaColada] } })
    await flushPromises()
    return w
}

const buttonByText = (w: Awaited<ReturnType<typeof mountTab>>, text: string) =>
    w.findAll('button').find(b => b.text() === text)!

describe('TemplatesTab', () => {
    it('lists templates and prompts for a selection', async () => {
        const w = await mountTab()

        expect(w.text()).toContain('Engineer')
        expect(w.text()).toContain('Planner')
        expect(w.text()).toContain('built-in')
        expect(w.text()).toContain('Select a template to view, or create a new one')
    })

    it('loads a template into the editor and saves edits', async () => {
        const w = await mountTab()

        await w.get('[data-template="1"]').trigger('click')
        expect((w.get('input[name="name"]').element as HTMLInputElement).value).toBe('Engineer')

        await w.get('input[name="name"]').setValue('Senior Engineer')
        await w.get('button[aria-label="Plan Mode"]').trigger('click')
        await w.get('input[name="max_turns"]').setValue('20')
        await buttonByText(w, 'Save Changes').trigger('click')
        await flushPromises()

        const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
        expect(call[0]).toBe('/api/agent-templates/1')
        expect(JSON.parse(call[1].body)).toMatchObject({ name: 'Senior Engineer', plan_mode: true, flags: { max_turns: 20 } })
        expect(w.get('[data-template="1"]').text()).toContain('Senior Engineer')
    })

    it('requires a name before creating a template', async () => {
        const w = await mountTab()

        await buttonByText(w, '+ New Template').trigger('click')
        await buttonByText(w, 'Create Template').trigger('click')

        expect(w.text()).toContain('Name is required')
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    })

    it('creates a template and adds it to the list', async () => {
        const w = await mountTab()

        await buttonByText(w, '+ New Template').trigger('click')
        await w.get('input[name="name"]').setValue('Tester')
        await w.get('select[name="agent_type"]').setValue('qa')
        await buttonByText(w, 'Create Template').trigger('click')
        await flushPromises()

        expect(w.get('[data-template="3"]').text()).toContain('Tester')
        expect(buttonByText(w, 'Save Changes').exists()).toBe(true)
    })

    it('deletes custom templates but never built-in ones', async () => {
        const w = await mountTab()

        await w.get('[data-template="2"]').trigger('click')
        expect(w.text()).toContain('It can’t be deleted.')
        expect(w.findAll('button').some(b => b.text() === 'Delete')).toBe(false)

        await w.get('[data-template="1"]').trigger('click')
        await buttonByText(w, 'Delete').trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/agent-templates/1', { method: 'DELETE' })
        expect(w.find('[data-template="1"]').exists()).toBe(false)
    })
})
