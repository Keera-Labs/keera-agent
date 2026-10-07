// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import ProvidersTab from './ProvidersTab.vue'

const { reload } = vi.hoisted(() => ({ reload: vi.fn() }))

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({
        props: {
            global_settings: {
                providers: [{ slug: 'codex', name: 'Codex', models: ['gpt-a', 'gpt-b'] }],
                default_provider: 'codex',
                enforce_default_provider: false,
                complexity_models: { codex: { easy: 'gpt-a', medium: 'gpt-b', hard: 'gpt-b' } },
            },
        },
    }),
    router: { reload },
}))

afterEach(() => vi.unstubAllGlobals())

describe('ProvidersTab', () => {
    it('saves models, enforcement and complexity tiers, then reloads global settings', async () => {
        const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
            const body = JSON.parse(init?.body as string)
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ ...body, provider_models: body.provider_models }),
            })
        })
        vi.stubGlobal('fetch', fetchMock)
        const w = mount(ProvidersTab)

        await w.get('button[aria-label="Enforce default provider"]').trigger('click')
        await w.get('button[aria-label="Remove gpt-b"]').trigger('click')
        await w.findAll('button').find(b => b.text() === '+ Add model')!.trigger('click')
        await w.get('input[aria-label="Codex model 2"]').setValue('  gpt-c  ')
        await w.findAll('button').find(b => b.text() === 'Save provider settings')!.trigger('click')
        await flushPromises()

        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/global-settings')
        expect(JSON.parse(init?.body as string)).toEqual({
            provider_models: { codex: ['gpt-a', 'gpt-c'] },
            default_provider: 'codex',
            enforce_default_provider: true,
            // gpt-b was removed, so tiers pointing at it fall back to the first remaining model.
            complexity_models: { codex: { easy: 'gpt-a', medium: 'gpt-a', hard: 'gpt-a' } },
        })
        expect(reload).toHaveBeenCalledWith({ only: ['global_settings'] })
        expect(w.text()).toContain('Saved ✓')
    })

    it('shows the server error when saving fails', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Nope' }) })))
        const w = mount(ProvidersTab)

        await w.findAll('button').find(b => b.text() === 'Save provider settings')!.trigger('click')
        await flushPromises()

        expect(w.text()).toContain('Nope')
    })
})
