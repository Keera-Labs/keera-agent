// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { reactive } from 'vue'
import ModalLayer from '@/layouts/ModalLayer.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import type { Project } from '@/types/type'
import DefaultPermissionsModal from './DefaultPermissionsModal.vue'
import ProjectPermissionsModal from './ProjectPermissionsModal.vue'
import SystemPromptModal from './SystemPromptModal.vue'

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({ component: 'Home', props: {} }),
    router: { visit: vi.fn(), reload: vi.fn() },
}))

const project = { id: 5, name: 'keera', slug: 'keera', system_prompt: 'Be terse.' } as Project

type Route = { status?: number; body: unknown }
let routes: Record<string, Route>
let fetchMock: ReturnType<typeof vi.fn>

function respond(url: string, init?: RequestInit) {
    const route = routes[`${init?.method ?? 'GET'} ${url}`] ?? { body: [] }
    const status = route.status ?? 200
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(route.body) })
}

function bodyOf(method: string, url: string) {
    const call = fetchMock.mock.calls.find(([u, init]) => u === url && init?.method === method)
    return call && JSON.parse(call[1].body)
}

function plugins() {
    const pinia = createPinia()
    setActivePinia(pinia)
    return [pinia, PiniaColada]
}

beforeEach(() => {
    routes = {}
    fetchMock = vi.fn(respond)
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('SystemPromptModal', () => {
    it('saves the trimmed prompt, then reports the update and closes', async () => {
        const updated = { ...project, system_prompt: 'Be kind.' }
        routes['PATCH /api/projects/5'] = { body: updated }
        const wrapper = mount(SystemPromptModal, { props: { project } })

        expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Be terse.')
        await wrapper.get('textarea').setValue('  Be kind.  ')
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(bodyOf('PATCH', '/api/projects/5')).toEqual({ system_prompt: 'Be kind.' })
        expect(wrapper.emitted('updated')).toEqual([[updated]])
        expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('clears the prompt to null and stays open on a server error', async () => {
        routes['PATCH /api/projects/5'] = { status: 422, body: { error: 'Nope' } }
        const wrapper = mount(SystemPromptModal, { props: { project } })

        await wrapper.get('textarea').setValue('   ')
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(bodyOf('PATCH', '/api/projects/5')).toEqual({ system_prompt: null })
        expect(wrapper.text()).toContain('Nope')
        expect(wrapper.emitted('close')).toBeUndefined()
    })
})

describe('permission dialogs', () => {
    it('loads and saves project permissions', async () => {
        routes['GET /api/projects/5/permissions'] = { body: { allow: ['Read'], deny: ['Bash(rm *)'] } }
        routes['PATCH /api/projects/5/permissions'] = { body: { allow: ['Read'], deny: ['Bash(rm *)'] } }
        const wrapper = mount(ProjectPermissionsModal, { props: { project } })
        await flushPromises()

        expect(wrapper.text()).toContain('Permissions — keera')
        expect(wrapper.text()).toContain('Bash(rm *)')
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(bodyOf('PATCH', '/api/projects/5/permissions')).toEqual({ allow: ['Read'], deny: ['Bash(rm *)'] })
        expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('shows a load error for default permissions and keeps the dialog open on a failed save', async () => {
        fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')))
        routes['PATCH /api/default-permissions'] = { status: 500, body: {} }
        const wrapper = mount(DefaultPermissionsModal)
        await flushPromises()
        expect(wrapper.text()).toContain('Failed to load defaults')

        await wrapper.get('form').trigger('submit')
        await flushPromises()
        expect(wrapper.text()).toContain('Something went wrong')
        expect(wrapper.emitted('close')).toBeUndefined()
    })
})

describe('ModalLayer', () => {
    it('opens the settings dialogs from store state and clears it on close', async () => {
        routes['GET /api/projects/5/permissions'] = { body: { allow: [], deny: [] } }
        const wrapper = mount(ModalLayer, { global: { plugins: plugins() }, attachTo: document.body })
        const store = useAppLayoutStore()

        store.showGlobalSettings = true
        await flushPromises()
        expect(wrapper.find('[role="dialog"][aria-label="Settings"]').exists()).toBe(true)
        expect(wrapper.text()).not.toContain('being migrated')
        await wrapper.get('[aria-label="Close"]').trigger('click')
        expect(store.showGlobalSettings).toBe(false)

        store.permissionsProject = project
        await flushPromises()
        expect(wrapper.text()).toContain('Permissions — keera')
        await wrapper.findAll('button').find(b => b.text() === 'Cancel')!.trigger('click')
        expect(store.permissionsProject).toBeNull()

        store.systemPromptProject = project
        await flushPromises()
        expect(wrapper.text()).toContain('System Instructions')
        await wrapper.findAll('button').find(b => b.text() === 'Cancel')!.trigger('click')
        expect(store.systemPromptProject).toBeNull()

        wrapper.unmount()
    })

    it('still flags the modals that are not ported yet', async () => {
        const wrapper = mount(ModalLayer, { global: { plugins: plugins() } })
        useAppLayoutStore().migratingModal = 'Something'
        await flushPromises()
        expect(wrapper.text()).toContain('Something is being migrated to Vue.')
    })
})
