// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Broadcasting from './Broadcasting.vue'

const pusher = vi.hoisted(() => ({
    connectionHandlers: {} as Record<string, (arg?: unknown) => void>,
    globalHandler: null as ((event: string, data: Record<string, unknown>) => void) | null,
    disconnect: vi.fn(),
}))

vi.mock('pusher-js', () => ({
    default: class {
        connection = { bind: (event: string, fn: (arg?: unknown) => void) => { pusher.connectionHandlers[event] = fn } }
        subscribe() {
            return { bind_global: (fn: typeof pusher.globalHandler) => { pusher.globalHandler = fn } }
        }
        channel() { return { unbind_all: () => {} } }
        unsubscribe() {}
        disconnect = pusher.disconnect
    },
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => vi.unstubAllGlobals())

async function mountConnected() {
    const w = mount(Broadcasting)
    pusher.connectionHandlers.connected()
    await flushPromises()
    return w
}

describe('Broadcasting', () => {
    it('waits for the connection before allowing a ping', async () => {
        const w = mount(Broadcasting)

        expect(w.get('[data-testid="connection-status"]').text()).toBe('connecting')
        expect(w.text()).toContain('Waiting for WebSocket connection…')
        expect(w.get('button').attributes('disabled')).toBeDefined()

        pusher.connectionHandlers.connected()
        await flushPromises()

        expect(w.get('[data-testid="connection-status"]').text()).toBe('connected')
        expect(w.text()).toContain('No events yet')
        expect(w.get('button').attributes('disabled')).toBeUndefined()
    })

    it('posts the typed message, defaulting to "ping"', async () => {
        fetchMock.mockResolvedValue({ ok: true } as Response)
        const w = await mountConnected()

        await w.get('input').setValue('hello')
        await w.get('input').trigger('keydown', { key: 'Enter' })
        await flushPromises()
        await w.get('button').trigger('click')
        await flushPromises()

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: 'hello' })
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ message: 'ping' })
        expect((w.get('input').element as HTMLInputElement).value).toBe('')
    })

    it('shows server errors', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as Response)
        const w = await mountConnected()

        await w.get('button').trigger('click')
        await flushPromises()

        expect(w.text()).toContain('Server error 500: boom')
    })

    it('logs channel events and ignores pusher lifecycle events', async () => {
        const w = await mountConnected()

        pusher.globalHandler?.('pusher:subscription_succeeded', {})
        pusher.globalHandler?.('PingEvent', { message: 'hi' })
        pusher.globalHandler?.('Other', { value: 1 })
        await flushPromises()

        const rows = w.findAll('tbody tr')
        expect(rows).toHaveLength(2)
        expect(rows[0].text()).toContain('PingEvent')
        expect(rows[0].text()).toContain('hi')
        expect(rows[1].text()).toContain('{"value":1}')
    })

    it('disconnects on unmount', async () => {
        const w = await mountConnected()
        w.unmount()
        expect(pusher.disconnect).toHaveBeenCalled()
    })
})
