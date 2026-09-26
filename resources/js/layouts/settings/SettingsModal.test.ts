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
    router: { visit: vi.fn(), reload: vi.fn() },
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

let globalPatch: { status: number; body: Record<string, unknown> }
let remoteControl: { status: number; enabled: boolean; error?: string }

function remoteControlFetch(init?: RequestInit) {
    const method = init?.method ?? 'GET'
    if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body))
        calls.push({ method, body })
        if (remoteControl.status < 400) remoteControl.enabled = body.enabled
    }
    const { status, enabled, error } = remoteControl
    const json = status < 400 ? { data: { attributes: { enabled } } } : { error }
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(json) })
}

function fakeFetch(url: string, init?: RequestInit) {
    if (url === '/api/settings/remote-control') return remoteControlFetch(init)
    if (url === '/api/global-settings') {
        calls.push({ method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) })
        const { status, body } = globalPatch
        return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
    }
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
    globalPatch = { status: 200, body: { max_agents_per_project: 25 } }
    remoteControl = { status: 200, enabled: false }
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
    vi.mocked(router.reload).mockClear()
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

    it('saves the max agents limit from the Agents tab through the footer', async () => {
        const { w, layout } = await open('ai')
        await w.get('[data-ai-tab="agents"]').trigger('click')
        const input = w.get('[data-testid="max-agents"]')
        const save = w.get('[data-testid="settings-save"]')

        expect((input.element as HTMLInputElement).value).toBe('10')
        expect(save.attributes('disabled')).toBeDefined()

        await input.setValue('250')
        await input.trigger('change')
        expect((input.element as HTMLInputElement).value).toBe('100')

        await input.setValue('25')
        await input.trigger('change')
        expect(w.get('[data-testid="settings-status"]').text()).toBe('Unsaved changes')
        await save.trigger('click')
        await flushPromises()

        expect(calls.filter(c => c.method === 'PATCH')).toEqual([{ method: 'PATCH', body: { max_agents_per_project: 25 } }])
        expect(layout.maxAgentsPerProject).toBe(25)
        expect(router.reload).toHaveBeenCalledWith({ only: ['global_settings'] })
        expect(w.get('[data-testid="settings-status"]').text()).toBe('Saved to Keera settings')
    })

    it('saves editor and agent edits together, and Discard drops both', async () => {
        const { w, layout } = await open('ai')
        await w.get('[data-ai-tab="agents"]').trigger('click')
        await w.get('[data-testid="max-agents"]').setValue('7')
        await w.get('[data-testid="max-agents"]').trigger('change')
        await w.get('[data-section="editor"]').trigger('click')
        await w.get('[data-preset="16"]').trigger('click')

        await w.get('[data-testid="settings-discard"]').trigger('click')
        expect(w.get('[data-testid="settings-save"]').attributes('disabled')).toBeDefined()

        await w.get('[data-preset="16"]').trigger('click')
        await w.get('[data-section="ai"]').trigger('click')
        await w.get('[data-ai-tab="agents"]').trigger('click')
        expect((w.get('[data-testid="max-agents"]').element as HTMLInputElement).value).toBe('10')
        await w.get('[data-testid="max-agents"]').setValue('7')
        await w.get('[data-testid="max-agents"]').trigger('change')
        await w.get('[data-testid="settings-save"]').trigger('click')
        await flushPromises()

        expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(2)
        expect(calls).toContainEqual({ method: 'PATCH', body: { max_agents_per_project: 7 } })
        expect(layout.maxAgentsPerProject).toBe(25)
    })

    it('shows the server error when the max agents limit is rejected', async () => {
        globalPatch = { status: 422, body: { error: 'max_agents_per_project must be an integer between 1 and 100' } }
        const { w, layout } = await open('ai')
        await w.get('[data-ai-tab="agents"]').trigger('click')

        await w.get('[data-testid="max-agents"]').setValue('5')
        await w.get('[data-testid="max-agents"]').trigger('change')
        await w.get('[data-testid="settings-save"]').trigger('click')
        await flushPromises()

        expect(w.get('[data-testid="settings-status"]').text()).toContain('between 1 and 100')
        expect(layout.maxAgentsPerProject).toBe(10)
        expect(router.reload).not.toHaveBeenCalled()
    })

    async function openAgentsTab() {
        const opened = await open('ai')
        await opened.w.get('[data-ai-tab="agents"]').trigger('click')
        await flushPromises()
        return { ...opened, toggle: () => opened.w.get('[data-testid="remote-control"]') }
    }

    it('loads the Remote Control toggle from ~/.claude.json', async () => {
        remoteControl.enabled = true
        const { w, toggle } = await openAgentsTab()

        expect(toggle().attributes('aria-pressed')).toBe('true')
        expect(w.text()).toContain('Applies to new Claude sessions; running agents are unaffected')
    })

    it('saves the Remote Control toggle on and off through the footer', async () => {
        const { w, toggle } = await openAgentsTab()
        const save = w.get('[data-testid="settings-save"]')

        expect(toggle().attributes('aria-pressed')).toBe('false')
        await toggle().trigger('click')
        expect(toggle().attributes('aria-pressed')).toBe('true')
        expect(w.get('[data-testid="settings-status"]').text()).toBe('Unsaved changes')

        await save.trigger('click')
        await flushPromises()
        expect(calls.filter(c => c.method === 'PATCH')).toEqual([{ method: 'PATCH', body: { enabled: true } }])
        expect(toggle().attributes('aria-pressed')).toBe('true')
        expect(w.get('[data-testid="settings-status"]').text()).toBe('Saved to Keera settings')

        await toggle().trigger('click')
        await save.trigger('click')
        await flushPromises()
        expect(calls.filter(c => c.method === 'PATCH').at(-1)).toEqual({ method: 'PATCH', body: { enabled: false } })
        expect(toggle().attributes('aria-pressed')).toBe('false')
    })

    it('Discard reverts the Remote Control toggle without saving', async () => {
        const { w, toggle } = await openAgentsTab()

        await toggle().trigger('click')
        await w.get('[data-testid="settings-discard"]').trigger('click')

        expect(toggle().attributes('aria-pressed')).toBe('false')
        expect(calls.some(c => c.method === 'PATCH')).toBe(false)
    })

    it('disables the toggle and shows the error when ~/.claude.json is invalid', async () => {
        remoteControl = { status: 409, enabled: false, error: '/home/me/.claude.json is not valid JSON' }
        const { w, toggle } = await openAgentsTab()

        expect(toggle().attributes('disabled')).toBeDefined()
        await toggle().trigger('click')
        expect(w.get('[data-testid="settings-save"]').attributes('disabled')).toBeDefined()
        expect(w.get('[data-testid="remote-control-error"]').text()).toContain('not valid JSON')
    })
})
