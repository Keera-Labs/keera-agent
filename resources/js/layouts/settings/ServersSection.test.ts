// @vitest-environment happy-dom
import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeServer } from '@/queries/serversQuery'
import ServersSection from './ServersSection.vue'

type Call = { url: string; method: string; body?: Record<string, unknown> }

function server(id: number, name: string, kind = 'cloud') {
    return { type: 'servers', id: String(id), attributes: { id, name, kind, base_url: `https://${name}.test`, has_token: true } }
}

let wrapper: VueWrapper | undefined
let calls: Call[]

function stubApi(list: ReturnType<typeof server>[], respond: (call: Call) => { ok: boolean; body: unknown } = call => ({
    ok: true,
    body: { data: server(9, String(call.body?.name ?? 'saved')) },
})) {
    calls = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined }
        calls.push(call)
        if (call.method === 'GET') return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: list }) })
        const { ok, body } = respond(call)
        return Promise.resolve({ ok, status: ok ? 200 : 422, json: () => Promise.resolve(body) })
    }))
}

async function mountSection() {
    wrapper = mount(ServersSection, { global: { plugins: [createPinia(), PiniaColada] } })
    await flushPromises()
    return wrapper
}

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
})

describe('normalizeServer', () => {
    it('flattens the resource and never carries a token', () => {
        const normalized = normalizeServer({ id: '4', attributes: { name: 'Box', kind: 'weird', base_url: 'http://x', has_token: 1, token: 'leak' } })
        expect(normalized).toEqual({ id: 4, name: 'Box', kind: 'local', base_url: 'http://x', has_token: true })
    })
})

describe('ServersSection', () => {
    it('lists the registered servers', async () => {
        stubApi([server(1, 'cloud-box'), server(2, 'laptop', 'local')])
        const wrapper = await mountSection()

        const rows = wrapper.findAll('[data-testid="server-row"]')
        expect(rows).toHaveLength(2)
        expect(rows[0].text()).toContain('cloud-box')
        expect(rows[0].text()).toContain('https://cloud-box.test')
        expect(rows[1].text()).toContain('local')
    })

    it('shows an empty state', async () => {
        stubApi([])
        const wrapper = await mountSection()

        expect(wrapper.find('[data-testid="servers-empty"]').exists()).toBe(true)
    })

    it('adds a server with its token', async () => {
        stubApi([])
        const wrapper = await mountSection()

        await wrapper.get('[data-testid="server-name"]').setValue('Cloud box')
        await wrapper.get('[data-testid="server-kind"]').setValue('cloud')
        await wrapper.get('[data-testid="server-url"]').setValue('https://keera.example.com')
        expect(wrapper.get('[data-testid="server-save"]').attributes('disabled')).toBeDefined()
        await wrapper.get('[data-testid="server-token"]').setValue('tok')
        await wrapper.get('[data-testid="server-form"]').trigger('submit')
        await flushPromises()

        const post = calls.find(c => c.method === 'POST')
        expect(post).toEqual({
            url: '/api/servers',
            method: 'POST',
            body: { name: 'Cloud box', kind: 'cloud', base_url: 'https://keera.example.com', token: 'tok' },
        })
        expect((wrapper.get('[data-testid="server-name"]').element as HTMLInputElement).value).toBe('')
    })

    it('edits a server and keeps its token when the field is left blank', async () => {
        stubApi([server(1, 'cloud-box')])
        const wrapper = await mountSection()

        await wrapper.get('[data-testid="server-edit"]').trigger('click')
        expect((wrapper.get('[data-testid="server-url"]').element as HTMLInputElement).value).toBe('https://cloud-box.test')
        await wrapper.get('[data-testid="server-name"]').setValue('renamed')
        await wrapper.get('[data-testid="server-form"]').trigger('submit')
        await flushPromises()

        const patch = calls.find(c => c.method === 'PATCH')
        expect(patch?.url).toBe('/api/servers/1')
        expect(patch?.body).toEqual({ name: 'renamed', kind: 'cloud', base_url: 'https://cloud-box.test' })
    })

    it('shows the API error when saving fails', async () => {
        stubApi([], () => ({ ok: false, body: { detail: [{ msg: 'Value error, base_url must be an http(s) URL' }] } }))
        const wrapper = await mountSection()

        await wrapper.get('[data-testid="server-name"]').setValue('Bad')
        await wrapper.get('[data-testid="server-url"]').setValue('ftp://nope')
        await wrapper.get('[data-testid="server-token"]').setValue('tok')
        await wrapper.get('[data-testid="server-form"]').trigger('submit')
        await flushPromises()

        expect(wrapper.get('[data-testid="server-error"]').text()).toContain('http(s) URL')
    })

    it('removes a server after confirmation', async () => {
        vi.stubGlobal('confirm', vi.fn(() => true))
        stubApi([server(1, 'cloud-box')])
        const wrapper = await mountSection()

        await wrapper.get('[data-testid="server-remove"]').trigger('click')
        await flushPromises()

        expect(calls.find(c => c.method === 'DELETE')?.url).toBe('/api/servers/1')
    })
})
