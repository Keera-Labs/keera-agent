// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { useCommandRunStore } from '@/stores/commandRunStore'
import CommandsPanel from './CommandsPanel.vue'
import type { Command } from './types'

vi.mock('@/composables/useTerminalSessions', () => ({}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))

const command = (overrides: Partial<Command> = {}): Command => ({
    id: 1,
    project_id: 7,
    label: 'dev',
    command: 'npm run dev',
    description: '',
    category: 'General',
    shortcut: '',
    kind: 'run',
    run: null,
    ...overrides,
})

const resource = ({ id, ...attributes }: Command) => ({ type: 'commands', id: String(id), attributes })

const jsonResponse = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body }) as Response

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

async function mountPanel(commands: Command[] = []) {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: commands.map(resource) }))
    const pinia = createPinia()
    const w = mount(CommandsPanel, { props: { projectId: 7 }, global: { plugins: [pinia, PiniaColada] } })
    await flushPromises()
    return { w, runs: useCommandRunStore(pinia) }
}

describe('CommandsPanel', () => {
    it('loads the project commands and offers no run controls', async () => {
        const { w } = await mountPanel([command()])

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/7/commands', expect.objectContaining({ method: 'GET' }))
        expect(w.text()).toContain('/dev')
        expect(w.find('button[title="Run"]').exists()).toBe(false)
        expect(w.find('button[title="Stop"]').exists()).toBe(false)
    })

    it('shows the empty state and opens the form from it', async () => {
        const { w } = await mountPanel()
        expect(w.text()).toContain('No commands yet')

        await w.get('button.border-dashed').trigger('click')
        expect(w.find('form').exists()).toBe(true)
    })

    it('creates a command and closes the form', async () => {
        const { w } = await mountPanel()
        fetchMock.mockResolvedValueOnce(jsonResponse({ data: resource(command({ id: 5, label: 'build', command: 'npm run build' })) }))

        await w.get('button.border-dashed').trigger('click')
        const [label, cmd] = w.findAll('form input')
        await label.setValue(' build ')
        await cmd.setValue('npm run build')
        await w.get('form').trigger('submit')
        await flushPromises()

        expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/7/commands', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ label: 'build', command: 'npm run build' }),
        }))
        expect(w.find('form').exists()).toBe(false)
        expect(w.text()).toContain('/build')
    })

    it('shows the server error when creation fails', async () => {
        const { w } = await mountPanel()
        fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Label taken' }, 422))

        await w.get('button.border-dashed').trigger('click')
        const [label, cmd] = w.findAll('form input')
        await label.setValue('dev')
        await cmd.setValue('npm run dev')
        await w.get('form').trigger('submit')
        await flushPromises()

        expect(w.text()).toContain('Label taken')
        expect(w.find('form').exists()).toBe(true)
    })

    it('edits a command inline', async () => {
        const { w } = await mountPanel([command()])
        fetchMock.mockResolvedValueOnce(jsonResponse({ data: resource(command({ label: 'serve', command: 'npm start' })) }))

        await w.get('button[title="Edit"]').trigger('click')
        const [label, cmd] = w.findAll('form input')
        await label.setValue('serve')
        await cmd.setValue('npm start')
        await w.get('form').trigger('submit')
        await flushPromises()

        expect(fetchMock).toHaveBeenLastCalledWith('/api/commands/1', expect.objectContaining({ method: 'PATCH' }))
        expect(w.find('form').exists()).toBe(false)
        expect(w.text()).toContain('/serve')
    })

    it('deletes a command and forgets its dock tabs', async () => {
        const { w, runs } = await mountPanel([command()])
        const forget = vi.spyOn(runs, 'forgetCommand')
        fetchMock.mockResolvedValue(jsonResponse(null, 204))

        await w.get('button[title="Delete"]').trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/commands/1', expect.objectContaining({ method: 'DELETE' }))
        expect(forget).toHaveBeenCalledWith(1)
        expect(w.text()).toContain('No commands yet')
    })
})
