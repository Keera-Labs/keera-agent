// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { reactive } from 'vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import Settings from './Index.vue'

vi.mock('@inertiajs/vue3', () => ({
    Head: { render: () => null },
    usePage: () => reactive({ component: 'settings/Index', url: '/settings', props: {} }),
    router: { visit: vi.fn() },
}))

function mountAt(url: string) {
    window.history.replaceState({}, '', url)
    const pinia = createPinia()
    mount(Settings, { global: { plugins: [pinia, PiniaColada] } })
    return useAppLayoutStore(pinia)
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
})

afterEach(() => vi.unstubAllGlobals())

describe('Settings page', () => {
    it('opens the Settings modal on the first section', () => {
        expect(mountAt('/settings').settingsSection).toBe('ai')
    })

    it('deep-links to the section named in ?section=', () => {
        expect(mountAt('/settings?section=editor').settingsSection).toBe('editor')
    })

    it('ignores an unknown section', () => {
        expect(mountAt('/settings?section=nope').settingsSection).toBe('ai')
    })
})
