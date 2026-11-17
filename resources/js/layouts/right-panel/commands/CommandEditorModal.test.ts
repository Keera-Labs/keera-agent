// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import type { Command } from '@/components/commands/types'
import CommandEditorModal from './CommandEditorModal.vue'

const SCRIPT = `cp ../../../.env ./.env && composer install && php artisan serve --port=8000
echo "it's done" | tee -a 'log.txt'
npm run dev`

const existing: Command = {
    id: 1, project_id: 7, label: 'dev', command: 'npm run dev', description: '', category: 'General', shortcut: '', kind: 'run', run: null,
}

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response)
const echoCommand = (id: string, init?: RequestInit) =>
    json({ data: { type: 'commands', id, attributes: { project_id: 7, kind: 'run', run: null, ...JSON.parse(String(init?.body)) } } })

let fetchMock: ReturnType<typeof vi.fn>
const wrappers: VueWrapper[] = []

function mountModal(command: Command | null = null) {
    const pinia = createPinia()
    const wrapper = mount(CommandEditorModal, {
        attachTo: document.body,
        props: { projectId: 7, command },
        global: { plugins: [pinia, PiniaColada] },
    })
    wrappers.push(wrapper)
    return { wrapper }
}

const field = (testId: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testId}"]`)!
const press = (target: EventTarget, init: KeyboardEventInit) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))

async function fill(name: string, script: string) {
    const nameInput = field('command-editor-name')
    nameInput.value = name
    nameInput.dispatchEvent(new Event('input'))
    const scriptInput = field('command-editor-script')
    scriptInput.value = script
    scriptInput.dispatchEvent(new Event('input'))
    await flushPromises()
}

const posted = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH')

beforeEach(() => {
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return echoCommand('2', init)
        if (init?.method === 'PATCH') return echoCommand(url.split('/').pop()!, init)
        return json({})
    })
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    wrappers.splice(0).forEach(w => w.unmount())
    vi.unstubAllGlobals()
})

describe('CommandEditorModal', () => {
    it('opens as a dialog with an empty name focused and a multi-line script editor', () => {
        mountModal()

        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New command')
        expect(document.activeElement).toBe(field('command-editor-name'))
        expect(field('command-editor-script').tagName).toBe('TEXTAREA')
    })

    it('saves a multi-line script with &&, pipes, quotes and relative paths verbatim', async () => {
        const { wrapper } = mountModal()
        await fill('Server', SCRIPT)

        field('command-editor-save').click()
        await flushPromises()

        expect(posted()).toHaveLength(1)
        expect(posted()[0][0]).toBe('/api/projects/7/commands')
        expect(JSON.parse(posted()[0][1].body)).toEqual({ label: 'Server', command: SCRIPT })
        expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('saves with Cmd+Enter and Ctrl+Enter from the script editor', async () => {
        const { wrapper } = mountModal()
        await fill('Server', SCRIPT)

        press(field('command-editor-script'), { key: 'Enter', metaKey: true })
        await flushPromises()
        expect(posted()).toHaveLength(1)

        press(field('command-editor-script'), { key: 'Enter', ctrlKey: true })
        await flushPromises()
        expect(posted()).toHaveLength(2)
        expect(wrapper.emitted('close')).toHaveLength(2)
    })

    it('keeps a plain Enter in the script as a new line instead of saving', async () => {
        mountModal()
        await fill('Server', 'npm install')

        press(field('command-editor-script'), { key: 'Enter' })
        await flushPromises()

        expect(posted()).toHaveLength(0)
    })

    it('shows validation and does not save an empty name or script', async () => {
        const { wrapper } = mountModal()
        await fill('  ', '   ')

        field('command-editor-save').click()
        await flushPromises()

        const dialog = document.querySelector('[role="dialog"]')!
        expect(dialog.textContent).toContain('Name is required')
        expect(dialog.textContent).toContain('Script is required')
        expect(posted()).toHaveLength(0)
        expect(wrapper.emitted('close')).toBeUndefined()
    })

    it('edits an existing command pre-filled and patches it', async () => {
        const { wrapper } = mountModal(existing)

        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Edit command')
        expect(field('command-editor-name').value).toBe('dev')
        expect(field('command-editor-script').value).toBe('npm run dev')

        await fill('dev', SCRIPT)
        field('command-editor-save').click()
        await flushPromises()

        expect(posted()[0][0]).toBe('/api/commands/1')
        expect(posted()[0][1].method).toBe('PATCH')
        expect(JSON.parse(posted()[0][1].body)).toEqual({ label: 'dev', command: SCRIPT })
        expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('shows the server error and stays open when saving fails', async () => {
        fetchMock.mockImplementation(() => json({ detail: 'Command is too long' }, 422))
        const { wrapper } = mountModal()
        await fill('Server', SCRIPT)

        field('command-editor-save').click()
        await flushPromises()

        expect(field('command-editor-error').textContent).toContain('Command is too long')
        expect(wrapper.emitted('close')).toBeUndefined()
    })

    it('closes on Cancel, Escape and a backdrop click without saving', async () => {
        const { wrapper } = mountModal()

        field('command-editor-cancel').click()
        press(window, { key: 'Escape' })
        document.querySelector<HTMLElement>('[data-testid="command-editor-backdrop"]')!.click()
        await flushPromises()

        expect(wrapper.emitted('close')).toHaveLength(3)
        expect(posted()).toHaveLength(0)
    })
})
