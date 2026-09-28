// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CommandsPanel from './CommandsPanel.vue'
import type { Command } from './types'

const term = {
    element: undefined as HTMLElement | undefined,
    cols: 80,
    rows: 24,
    loadAddon: vi.fn(),
    open: vi.fn(),
    focus: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
}

vi.mock('@/composables/useTerminalSessions', () => ({
    makeTerminal: () => term,
    attachTerminal: vi.fn(),
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

class FakeWebSocket {
    static OPEN = 1
    static instances: FakeWebSocket[] = []
    readyState = 1
    binaryType = ''
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((e: MessageEvent) => void) | null = null
    constructor(public url: string) { FakeWebSocket.instances.push(this) }
    send = vi.fn()
    close = vi.fn(() => this.onclose?.())
}

class FakeResizeObserver {
    observe() {}
    disconnect() {}
}

const command = (overrides: Partial<Command> = {}): Command => ({
    id: 1,
    project_id: 7,
    label: 'dev',
    command: 'npm run dev',
    description: '',
    category: '',
    shortcut: '',
    status: 'stopped',
    pid: null,
    ...overrides,
})

const jsonResponse = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    FakeWebSocket.instances = []
})

afterEach(() => vi.unstubAllGlobals())

function mountPanel(initialCommands: Command[] = []) {
    return mount(CommandsPanel, { props: { projectId: 7, projectSlug: 'acme', initialCommands } })
}

describe('CommandsPanel', () => {
    it('shows the empty state and opens the form from it', async () => {
        const w = mountPanel()
        expect(w.text()).toContain('No commands yet')

        await w.get('button.border-dashed').trigger('click')
        expect(w.find('form').exists()).toBe(true)
    })

    it('creates a command and closes the form', async () => {
        fetchMock.mockResolvedValue(jsonResponse(command({ id: 5, label: 'build', command: 'npm run build' })))
        const w = mountPanel()

        await w.get('button.border-dashed').trigger('click')
        const [label, cmd] = w.findAll('form input')
        await label.setValue(' build ')
        await cmd.setValue('npm run build')
        await w.get('form').trigger('submit')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/7/commands', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ label: 'build', command: 'npm run build' }),
        }))
        expect(w.find('form').exists()).toBe(false)
        expect(w.text()).toContain('/build')
    })

    it('shows the server error when creation fails', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: 'Label taken' }, false))
        const w = mountPanel()

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
        fetchMock.mockResolvedValue(jsonResponse({ label: 'serve', command: 'npm start' }))
        const w = mountPanel([command()])

        await w.get('button[title="Edit"]').trigger('click')
        const [label, cmd] = w.findAll('form input')
        await label.setValue('serve')
        await cmd.setValue('npm start')
        await w.get('form').trigger('submit')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/commands/1', expect.objectContaining({ method: 'PATCH' }))
        expect(w.find('form').exists()).toBe(false)
        expect(w.text()).toContain('/serve')
    })

    it('deletes a command and closes its output panel', async () => {
        fetchMock.mockResolvedValue(jsonResponse({}))
        const w = mountPanel([command()])

        await w.get('div.cursor-pointer').trigger('click')
        expect(w.find('h2').text()).toBe('/dev')

        await w.get('button[title="Delete"]').trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/commands/1', { method: 'DELETE' })
        expect(w.find('h2').exists()).toBe(false)
        expect(w.text()).toContain('No commands yet')
    })

    it('runs a command over its WebSocket and marks it stopped when stopped', async () => {
        fetchMock.mockResolvedValue(jsonResponse({}))
        const w = mountPanel([command()])

        await w.get('button[title="Run"]').trigger('click')
        await flushPromises()

        const ws = FakeWebSocket.instances[0]
        expect(ws.url).toMatch(/\/acme\/command-ws\/1$/)
        expect(term.open).toHaveBeenCalled()

        ws.onopen?.()
        await flushPromises()
        expect(w.text()).toContain('1 running')

        await w.get('button[title="Stop"]').trigger('click')
        await flushPromises()

        expect(ws.close).toHaveBeenCalled()
        expect(fetchMock).toHaveBeenCalledWith('/api/commands/1/stop', { method: 'POST' })
        expect(w.text()).not.toContain('running')
        expect(w.text()).toContain('exited')
    })

    it('reseeds its list when the server props change', async () => {
        const w = mountPanel([command()])
        await w.setProps({ initialCommands: [command({ id: 2, label: 'lint' })] })

        expect(w.text()).toContain('/lint')
        expect(w.text()).not.toContain('/dev')
    })
})
