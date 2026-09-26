// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Settings from './Index.vue'

vi.mock('@inertiajs/vue3', () => ({ Head: { render: () => null } }))

const stubs = {
    ProvidersTab: { template: '<div data-view="providers" />' },
    TemplatesTab: { template: '<div data-view="templates" />' },
    DefaultPermissionsTab: { template: '<div data-view="permissions" />' },
    PluginsTab: { template: '<div data-view="plugins" />' },
}

describe('Settings page', () => {
    it('opens on the providers tab and switches between tabs', async () => {
        const w = mount(Settings, { global: { stubs } })
        const view = () => w.get('[data-view]').attributes('data-view')

        expect(view()).toBe('providers')

        for (const tab of ['templates', 'permissions', 'plugins', 'providers']) {
            await w.get(`[data-tab="${tab}"]`).trigger('click')
            expect(view()).toBe(tab)
            expect(w.get(`[data-tab="${tab}"]`).classes()).toContain('text-zinc-900')
        }
    })
})
