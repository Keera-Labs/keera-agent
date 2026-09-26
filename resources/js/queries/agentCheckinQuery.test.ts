// @vitest-environment happy-dom
import { http } from '@inertiajs/vue3'
import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { HttpRequestError } from '@/composables/useHttp'
import { useAgentCheckin, type AgentCheckin } from './agentCheckinQuery'

const stopped: AgentCheckin = { enabled: false, interval_minutes: 5, running: false }
const started: AgentCheckin = { enabled: true, interval_minutes: 10, running: true }

function response(body: unknown, status = 200) {
    return { status, data: JSON.stringify(body), headers: {} }
}

const requestMock = vi.fn()
const originalClient = http.getClient()

function mountUseAgentCheckin(agentId: number | null = 7) {
    const id = ref(agentId)
    let api!: ReturnType<typeof useAgentCheckin>
    mount(
        defineComponent({
            setup() {
                api = useAgentCheckin(id)
                return () => null
            },
        }),
        { global: { plugins: [createPinia(), PiniaColada] } },
    )
    return { api, id }
}

beforeEach(() => {
    requestMock.mockReset()
    http.setClient({ request: requestMock })
})

afterEach(() => {
    http.setClient(originalClient)
})

describe('useAgentCheckin', () => {
    it('fetches the check-in state as JSON', async () => {
        requestMock.mockResolvedValue(response(stopped))
        const { api } = mountUseAgentCheckin()
        await flushPromises()

        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
            method: 'get',
            url: '/api/agents/7/checkin',
            headers: expect.objectContaining({ Accept: 'application/json' }),
        }))
        expect(api.checkin.value).toEqual(stopped)
    })

    it('does not fetch without an agent', async () => {
        const { api } = mountUseAgentCheckin(null)
        await flushPromises()

        expect(requestMock).not.toHaveBeenCalled()
        expect(api.checkin.value).toBeUndefined()
    })

    it('sends the toggle payload as a JSON PATCH and caches the result', async () => {
        requestMock.mockResolvedValueOnce(response(stopped))
        const { api } = mountUseAgentCheckin()
        await flushPromises()

        requestMock.mockResolvedValueOnce(response(started))
        await api.update.mutateAsync({ enabled: true, interval_minutes: 10 })

        expect(requestMock).toHaveBeenLastCalledWith(expect.objectContaining({
            method: 'patch',
            url: '/api/agents/7/checkin',
            data: '{"enabled":true,"interval_minutes":10}',
            headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }))
        expect(api.checkin.value).toEqual(started)
    })

    it('rejects and keeps the cache when the update fails', async () => {
        requestMock.mockResolvedValueOnce(response(stopped))
        const { api } = mountUseAgentCheckin()
        await flushPromises()

        requestMock.mockResolvedValueOnce(response({}, 500))
        await expect(api.update.mutateAsync({ enabled: true, interval_minutes: 10 })).rejects.toThrow()

        expect(api.checkin.value).toEqual(stopped)
    })

    it('rejects on a validation error instead of caching undefined', async () => {
        requestMock.mockResolvedValueOnce(response(stopped))
        const { api } = mountUseAgentCheckin()
        await flushPromises()

        requestMock.mockResolvedValueOnce(response({ detail: [{ loc: ['body', 'interval_minutes'] }] }, 422))
        await expect(api.update.mutateAsync({ enabled: true, interval_minutes: 0 }))
            .rejects.toMatchObject({ constructor: HttpRequestError, status: 422 })

        expect(api.checkin.value).toEqual(stopped)
    })

    it('leaves the state empty when the fetch fails', async () => {
        requestMock.mockResolvedValue(response({}, 404))
        const { api } = mountUseAgentCheckin()
        await flushPromises()

        expect(api.checkin.value).toBeUndefined()
    })
})
