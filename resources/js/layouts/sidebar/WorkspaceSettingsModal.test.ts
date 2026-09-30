// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import type { Workspace } from '@/types/type'
import WorkspaceSettingsModal from './WorkspaceSettingsModal.vue'

vi.mock('@inertiajs/vue3', () => ({ usePage: () => ({ props: {} }) }))

const workspace: Workspace = { id: 3, name: 'Office', description: null, claude_config_dir: '~/.claude-work' }

let patches: Record<string, unknown>[]
let wrapper: VueWrapper | undefined

beforeEach(() => {
    patches = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') patches.push({ url, ...JSON.parse(String(init.body)) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    }))
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
})

async function openModal() {
    wrapper = mount(WorkspaceSettingsModal, {
        props: { workspace },
        slots: { trigger: '<button data-testid="open">Settings</button>' },
        attachTo: document.body,
        global: { plugins: [createPinia(), PiniaColada] },
    })
    await wrapper.get('[data-testid="open"]').trigger('click')
    await flushPromises()
}

const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!

async function setAndSubmit(value: string) {
    const field = input('claude_config_dir')
    field.value = value
    field.dispatchEvent(new Event('input'))
    document.querySelector('form')!.dispatchEvent(new Event('submit'))
    await flushPromises()
}

describe('WorkspaceSettingsModal', () => {
    it('prefills the current settings', async () => {
        await openModal()

        expect(input('name').value).toBe('Office')
        expect(input('claude_config_dir').value).toBe('~/.claude-work')
    })

    it('saves a new Claude config directory', async () => {
        await openModal()
        await setAndSubmit(' ~/.claude-personal ')

        expect(patches).toEqual([{
            url: '/api/workspaces/3', name: 'Office', description: '', claude_config_dir: '~/.claude-personal',
        }])
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })

    it('clears the setting when emptied', async () => {
        await openModal()
        await setAndSubmit('  ')

        expect(patches[0].claude_config_dir).toBeNull()
    })

    it('rejects a relative path without calling the server', async () => {
        await openModal()
        await setAndSubmit('claude-work')

        expect(patches).toEqual([])
        expect(document.querySelector('[data-testid="workspace-settings-error"]')?.textContent)
            .toContain('absolute path')
    })
})
