// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { AgentTemplate } from '@/types/agent'
import ProjectTemplatesModal from './ProjectTemplatesModal.vue'

const refetchAgentTemplates = vi.hoisted(() => vi.fn())

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({
        props: {
            global_settings: {
                providers: [
                    { slug: 'codex', name: 'Codex', models: ['gpt-a', 'gpt-b'] },
                    { slug: 'claude', name: 'Claude', models: ['opus', 'sonnet'] },
                ],
            },
        },
    }),
}))

vi.mock('@/stores/appLayoutStore', () => ({
    useAppLayoutStore: () => ({ refetchAgentTemplates }),
}))

function template(id: number, name: string, extra: Partial<AgentTemplate> = {}): AgentTemplate {
    return {
        id, name, description: null, agent_type: 'software_engineer', provider: 'codex', model: 'gpt-b',
        system_prompt: null, flags: {}, plan_mode: false, is_builtin: true, is_override: false,
        ...extra,
    } as AgentTemplate
}

let list: AgentTemplate[]
let wrapper: VueWrapper | undefined

function fakeFetch(url: string, init?: RequestInit) {
    const method = init?.method ?? 'GET'
    let body: unknown = list
    if (method === 'POST' && url.endsWith('/reset')) list = list.filter(t => !t.is_override)
    else if (method === 'POST') {
        const created = template(50, JSON.parse(init!.body as string).name, { is_builtin: false })
        list = [...list, created]
        body = created
    } else if (method === 'PATCH') {
        const override = template(60, JSON.parse(init!.body as string).name, { is_override: true })
        list = [override, ...list.slice(1)]
        body = override
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
}

async function mountModal() {
    wrapper = mount(ProjectTemplatesModal, { attachTo: document.body, props: { projectId: 3, projectName: 'demo' } })
    await flushPromises()
    return wrapper
}

const requests = () => vi.mocked(fetch).mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
const buttonByText = (w: VueWrapper, text: string) => w.findAll('button').find(b => b.text() === text)!

beforeEach(() => {
    list = [template(1, 'Engineer'), template(2, 'Reviewer', { is_override: true, is_builtin: false })]
    refetchAgentTemplates.mockReset()
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
})

describe('ProjectTemplatesModal', () => {
    it("lists the project's effective templates and syncs the layout's list", async () => {
        const w = await mountModal()

        const items = w.findAll('[data-testid="template-item"]')
        expect(items.map(i => i.text())).toEqual([
            expect.stringContaining('global'),
            expect.stringContaining('OVERRIDE'),
        ])
        expect(requests()).toEqual(['GET /api/projects/3/agent-templates'])
        expect(refetchAgentTemplates).toHaveBeenCalledTimes(1)
        expect(w.text()).toContain('Select a template to edit it')
    })

    it('saving a global template forks an override with PATCH', async () => {
        const w = await mountModal()
        await w.findAll('[data-testid="template-item"]')[0].trigger('click')

        expect((w.get('input[name="name"]').element as HTMLInputElement).value).toBe('Engineer')
        await w.get('input[name="name"]').setValue('Engineer v2')
        await w.get('[data-testid="flag-plan-mode"]').trigger('click')
        await buttonByText(w, 'Save (creates override)').trigger('click')
        await flushPromises()

        const patch = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH')!
        expect(patch[0]).toBe('/api/projects/3/agent-templates/1')
        expect(JSON.parse(patch[1]!.body as string)).toMatchObject({ name: 'Engineer v2', plan_mode: true, model: 'gpt-b' })
        expect(w.text()).toContain('Project override — shadows a global template')
        expect(buttonByText(w, 'Save').exists()).toBe(true)
    })

    it('creates a project-only template with POST', async () => {
        const w = await mountModal()
        await buttonByText(w, '+ New (project only)').trigger('click')

        await buttonByText(w, 'Save').trigger('click')
        expect(w.text()).toContain('Name is required')

        await w.get('input[name="name"]').setValue('Docs writer')
        await w.get('select[name="provider"]').setValue('claude')
        expect(w.findAll('select[name="model"] option').map(o => o.text())).toEqual(['opus', 'sonnet'])
        await w.get('[data-testid="flag-skip-permissions"]').trigger('click')
        await buttonByText(w, 'Save').trigger('click')
        await flushPromises()

        const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!
        expect(post[0]).toBe('/api/projects/3/agent-templates')
        expect(JSON.parse(post[1]!.body as string)).toMatchObject({
            name: 'Docs writer', provider: 'claude', model: 'opus', flags: { dangerously_skip_permissions: true },
        })
        expect(w.findAll('[data-testid="template-item"]')).toHaveLength(3)
    })

    it('reverts a single override and resets all overrides', async () => {
        const w = await mountModal()
        await w.findAll('[data-testid="template-item"]')[1].trigger('click')

        await buttonByText(w, 'Revert to global').trigger('click')
        await flushPromises()
        expect(requests()).toContain('DELETE /api/projects/3/agent-templates/2')
        expect(w.text()).toContain('Select a template to edit it')

        await buttonByText(w, 'Reset all to global').trigger('click')
        await flushPromises()
        expect(requests()).toContain('POST /api/projects/3/agent-templates/reset')
        expect(w.findAll('[data-testid="template-item"]')).toHaveLength(1)
    })

    it('closes from the Close button and the backdrop', async () => {
        const w = await mountModal()
        await w.findAll('[data-testid="template-item"]')[0].trigger('click')

        await buttonByText(w, 'Close').trigger('click')
        await w.get('[data-testid="templates-backdrop"]').trigger('click')

        expect(w.emitted('close')).toHaveLength(2)
    })
})
