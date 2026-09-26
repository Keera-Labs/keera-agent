// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DefaultPermissionsTab from './DefaultPermissionsTab.vue'

afterEach(() => vi.unstubAllGlobals())

describe('DefaultPermissionsTab', () => {
    it('loads the rules and saves edits', async () => {
        const fetchMock = vi.fn((_url: string, init?: RequestInit) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(init?.method === 'PATCH'
                ? JSON.parse(init.body as string)
                : { allow: ['Read'], deny: ['Bash(rm *)'] }),
        }))
        vi.stubGlobal('fetch', fetchMock)
        const w = mount(DefaultPermissionsTab)
        await flushPromises()

        expect(w.text()).toContain('Read')
        expect(w.text()).toContain('Bash(rm *)')

        const allowInput = w.findAll('input')[0]
        await allowInput.setValue('Bash(npm run *)')
        await allowInput.trigger('keydown', { key: 'Enter' })
        await w.get('button.min-w-\\[140px\\]').trigger('click')
        await flushPromises()

        const [, init] = fetchMock.mock.calls[1]
        expect(init?.method).toBe('PATCH')
        expect(JSON.parse(init?.body as string)).toEqual({ allow: ['Read', 'Bash(npm run *)'], deny: ['Bash(rm *)'] })
        expect(w.text()).toContain('✓ Saved')
    })

    it('accepts a rule containing a comma as a single tag', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ allow: [], deny: [] }),
        })))
        const w = mount(DefaultPermissionsTab)
        await flushPromises()

        const allowInput = w.findAll('input')[0]
        for (const key of 'Bash(echo a, b)') {
            await allowInput.setValue((allowInput.element as HTMLInputElement).value + key)
            await allowInput.trigger('keydown', { key })
        }
        await allowInput.trigger('keydown', { key: 'Enter' })

        const tags = w.findAll('span.font-mono').map(s => s.text().replace('×', '').trim())
        expect(tags).toEqual(['Bash(echo a, b)'])
    })

    it('shows the server error when saving fails', async () => {
        vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => Promise.resolve({
            ok: init?.method !== 'PATCH',
            json: () => Promise.resolve(init?.method === 'PATCH' ? { error: 'Invalid rule' } : { allow: [], deny: [] }),
        })))
        const w = mount(DefaultPermissionsTab)
        await flushPromises()

        await w.get('button.min-w-\\[140px\\]').trigger('click')
        await flushPromises()

        expect(w.text()).toContain('Invalid rule')
    })
})
