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
let patchResponse: { status: number; body: unknown }
let wrapper: VueWrapper | undefined

beforeEach(() => {
    patches = []
    patchResponse = { status: 200, body: {} }
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
            patches.push({ url, ...JSON.parse(String(init.body)) })
            const { status, body } = patchResponse
            return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) })
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

const errorText = () => document.querySelector('[data-testid="workspace-settings-error"]')?.textContent?.trim()
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

    it.each(['claude-work', '~nosuchuser/x'])('rejects %s without calling the server', async path => {
        await openModal()
        await setAndSubmit(path)

        expect(patches).toEqual([])
        expect(errorText()).toContain('absolute path or start with ~/')
    })

    it("shows the server's validation message", async () => {
        patchResponse = {
            status: 422,
            body: { errors: { claude_config_dir: ['Value error, Server says no'] } },
        }
        await openModal()
        await setAndSubmit('~/.claude-work')

        expect(errorText()).toBe('Server says no')
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    })

    it('explains the one-time login and workspace trust setup', async () => {
        await openModal()

        const setup = document.querySelector('[data-testid="workspace-settings-setup"]')?.textContent
        expect(setup).toContain('log in')
        expect(setup).toContain('workspace trust')
    })
})
