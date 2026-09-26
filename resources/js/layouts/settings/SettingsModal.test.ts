// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { reactive } from 'vue'
import { router } from '@inertiajs/vue3'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useEditorSettingsStore } from '@/stores/editorSettingsStore'
import SettingsModal from './SettingsModal.vue'

const page = reactive({ component: 'Home', url: '/', props: {} })

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => page,
    router: { visit: vi.fn() },
}))

const stubs = {
    ProvidersTab: { template: '<div data-view="providers" />' },
    TemplatesTab: { template: '<div data-view="templates" />' },
    DefaultPermissionsTab: { template: '<div data-view="permissions" />' },
    PluginsTab: { template: '<div data-view="plugins" />' },
}

type Call = { method: string; body?: unknown }
let calls: Call[]
let saved: Record<string, unknown>

function fakeFetch(url: string, init?: RequestInit) {
    if (url !== '/api/settings/editor') return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, body })
    if (method === 'PATCH') saved = { ...body, customized: true }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { attributes: saved } }) })
}

let wrapper: VueWrapper | undefined

async function open(section: Parameters<ReturnType<typeof useAppLayoutStore>['openSettings']>[0] = 'ai') {
    const pinia = createPinia()
    wrapper = mount(SettingsModal, { attachTo: document.body, global: { plugins: [pinia, PiniaColada], stubs } })
    const layout = useAppLayoutStore(pinia)
    layout.openSettings(section)
    await flushPromises()
    return { w: wrapper, layout, settings: useEditorSettingsStore(pinia) }
}

const navLabels = (w: VueWrapper) => w.findAll('[data-section]').map(b => b.attributes('data-section'))

beforeEach(() => {
    calls = []
    saved = { font_family: 'dank-mono', font_size: 13, hide_hidden: false, hide_ignored: false, hidden_patterns: [], customized: false }
    page.component = 'Home'
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    // happy-dom has no FontFaceSet; saving applies the font to terminals through it.
    Object.defineProperty(document, 'fonts', { value: { load: () => Promise.resolve([]) }, configurable: true })
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.mocked(router.visit).mockClear()
})

describe('SettingsModal', () => {
    it('lists every section and switches the pane', async () => {
        const { w } = await open()

        expect(navLabels(w)).toEqual(['ai', 'general', 'editor', 'terminal', 'git', 'workspaces', 'keybindings', 'billing'])
        expect(w.find('[data-view="providers"]').exists()).toBe(true)

        await w.get('[data-ai-tab="templates"]').trigger('click')
        expect(w.find('[data-view="templates"]').exists()).toBe(true)

        await w.get('[data-section="general"]').trigger('click')
        expect(w.find('[data-view="plugins"]').exists()).toBe(true)

        await w.get('[data-section="editor"]').trigger('click')
        expect(w.find('[data-testid="editor-section"]').exists()).toBe(true)
        expect(w.get('[data-section="editor"]').attributes('aria-current')).toBe('page')
    })

    it('shows an empty state for sections with nothing to configure', async () => {
        const { w } = await open('billing')

        expect(w.get('[data-testid="settings-empty"]').text()).toContain('Billing & Limits')
        expect(w.text()).not.toMatch(/Pro Plan/i)
    })

    it('filters sections by label and keyword, and Enter opens the first match', async () => {
        const { w, layout } = await open()
        const search = w.get('[data-testid="settings-search"]')

        await search.setValue('font')
        expect(navLabels(w)).toEqual(['editor', 'terminal'])

        await search.trigger('keydown', { key: 'Enter' })
        expect(layout.settingsSection).toBe('editor')

        await search.setValue('zzz')
        expect(w.find('[data-testid="settings-no-match"]').exists()).toBe(true)
    })

    it('previews edits live, then saves them through the footer', async () => {
        const { w, settings } = await open('editor')
        const save = w.get('[data-testid="settings-save"]')

        expect(save.attributes('disabled')).toBeDefined()

        await w.get('[data-testid="font-family"]').setValue('jetbrains-mono')
        await w.get('[data-preset="16"]').trigger('click')

        const preview = w.get('[data-testid="font-preview"]').attributes('style')
        expect(preview).toContain('JetBrains Mono')
        expect(preview).toContain('16px')
        expect(w.get('[data-testid="settings-status"]').text()).toBe('Unsaved changes')
        // Nothing reaches the editor or terminals before Save.
        expect(settings.font.fontSize).toBe(13)

        await save.trigger('click')
        await flushPromises()

        expect(calls.at(-1)).toEqual({ method: 'PATCH', body: expect.objectContaining({ font_family: 'jetbrains-mono', font_size: 16 }) })
        expect(settings.font).toEqual({ fontFamily: expect.stringContaining('JetBrains Mono'), fontSize: 16 })
        expect(w.get('[data-testid="settings-status"]').text()).toBe('Saved to Keera settings')
    })

    it('saves the Files filters and hide patterns', async () => {
        const { w, settings } = await open('editor')
        const files = w.get('[data-testid="file-filters"]')

        await files.get('[data-filter="hide_ignored"]').trigger('click')
        const pattern = files.get('input')
        await pattern.setValue(' *.log ')
        await pattern.trigger('keydown', { key: 'Enter' })
        await pattern.setValue('build/')
        await pattern.trigger('keydown', { key: ',' })
        expect(files.get('[data-filter="hide_ignored"]').attributes('aria-pressed')).toBe('true')

        await w.get('[data-testid="settings-save"]').trigger('click')
        await flushPromises()

        expect(calls.at(-1)?.body).toMatchObject({ hide_hidden: false, hide_ignored: true, hidden_patterns: ['*.log', 'build/'] })
        expect(settings.fileFilters).toEqual({ hide_hidden: false, hide_ignored: true, hidden_patterns: ['*.log', 'build/'] })
    })

    it('clamps the size stepper to 11-20', async () => {
        const { w } = await open('editor')
        const input = w.get('[data-testid="font-size-input"]')

        await input.setValue('40')
        expect(w.get('[data-testid="font-size-badge"]').text()).toBe('20px')
        expect(w.get('[aria-label="Increase font size"]').attributes('disabled')).toBeDefined()

        await input.setValue('2')
        expect(w.get('[data-testid="font-size-badge"]').text()).toBe('11px')
    })

    it('Discard restores the saved values', async () => {
        const { w } = await open('editor')

        await w.get('[data-preset="20"]').trigger('click')
        await w.get('[data-testid="settings-discard"]').trigger('click')

        expect(w.get('[data-testid="font-size-badge"]').text()).toBe('13px')
        expect(calls.some(c => c.method === 'PATCH')).toBe(false)
    })

    it('closes on Escape and on backdrop click, dropping unsaved edits', async () => {
        const { w, layout, settings } = await open('editor')

        await w.get('[data-preset="20"]').trigger('click')
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        expect(layout.settingsSection).toBeNull()
        expect(settings.draft.font_size).toBe(13)

        layout.openSettings('editor')
        await flushPromises()
        await w.get('[data-testid="settings-backdrop"]').trigger('click')
        expect(layout.settingsSection).toBeNull()
        expect(router.visit).not.toHaveBeenCalled()
    })

    it('leaves the /settings deep link for the dashboard when closed', async () => {
        page.component = 'settings/Index'
        const { w } = await open()

        await w.get('[aria-label="Close settings"]').trigger('click')
        expect(router.visit).toHaveBeenCalledWith('/', { replace: true })
    })
})
