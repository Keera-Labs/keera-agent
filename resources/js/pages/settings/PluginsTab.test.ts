// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PluginsTab from './PluginsTab.vue'

const plugin = (overrides = {}) => ({
    slug: 'hello', name: 'Hello', description: 'Says hi', version: '1.0', path: null, active: false, ...overrides,
})

function stubFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; body: unknown }) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        const { ok, body } = handler(url, init)
        return Promise.resolve({ ok, json: () => Promise.resolve(body) })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('PluginsTab', () => {
    it('shows loading, then the discovered plugins', async () => {
        stubFetch(() => ({ ok: true, body: { data: [plugin()] } }))
        const w = mount(PluginsTab)

        expect(w.text()).toContain('Loading…')
        await flushPromises()

        expect(w.text()).toContain('Hello')
        expect(w.text()).toContain('v1.0')
        expect(w.text()).toContain('Inactive')
    })

    it('shows the empty state when no plugins exist', async () => {
        stubFetch(() => ({ ok: true, body: { data: [] } }))
        const w = mount(PluginsTab)
        await flushPromises()

        expect(w.text()).toContain('No plugins discovered.')
    })

    it('activates a plugin through the API', async () => {
        const fetchMock = stubFetch(url => url.endsWith('/activate')
            ? { ok: true, body: { data: plugin({ active: true }) } }
            : { ok: true, body: { data: [plugin()] } })
        const w = mount(PluginsTab)
        await flushPromises()

        await w.get('button[title="Activate"]').trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/plugins/hello/activate', { method: 'POST' })
        expect(w.text()).toContain('Active')
        expect(w.get('button[aria-pressed]').attributes('aria-pressed')).toBe('true')
    })

    it('rolls back and reports an error when the toggle fails', async () => {
        stubFetch(url => url.endsWith('/activate')
            ? { ok: false, body: {} }
            : { ok: true, body: { data: [plugin()] } })
        const w = mount(PluginsTab)
        await flushPromises()

        await w.get('button[title="Activate"]').trigger('click')
        await flushPromises()

        expect(w.text()).toContain('Could not activate Hello. Please try again.')
        expect(w.get('button[aria-pressed]').attributes('aria-pressed')).toBe('false')
    })
})
