// @vitest-environment happy-dom
import { http } from '@inertiajs/vue3'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { HttpRequestError, useHttp, type HttpClient } from './useHttp'

interface Item {
    id: number
}

function response(body: unknown, status = 200) {
    return { status, data: JSON.stringify(body), headers: {} }
}

function setupClient(): HttpClient {
    let client!: HttpClient
    mount(defineComponent({
        setup() {
            client = useHttp()
            return () => null
        },
    }))
    return client
}

const requestMock = vi.fn()
const originalClient = http.getClient()

beforeEach(() => {
    requestMock.mockReset()
    http.setClient({ request: requestMock })
})

afterEach(() => {
    http.setClient(originalClient)
})

describe('useHttp', () => {
    it('resolves the parsed JSON body with the requested type', async () => {
        requestMock.mockResolvedValue(response({ id: 1 }))
        const client = setupClient().throwOnError()

        const item = client.get<Item>('/api/items/1')

        expectTypeOf(item).toEqualTypeOf<Promise<Item>>()
        await expect(item).resolves.toEqual({ id: 1 })
        expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'get', url: '/api/items/1' }))
    })

    it('sends each call its own JSON body', async () => {
        requestMock.mockResolvedValue(response({ id: 1 }))
        const client = setupClient().throwOnError()

        await client.post<Item>('/api/items', { name: 'first' })
        await client.patch<Item>('/api/items/1', { name: 'second' })
        await client.delete<Item>('/api/items/1')

        expect(requestMock.mock.calls.map(([config]) => [config.method, config.data])).toEqual([
            ['post', '{"name":"first"}'],
            ['patch', '{"name":"second"}'],
            ['delete', '{}'],
        ])
    })

    it('rejects a 422 with a typed validation error', async () => {
        requestMock.mockResolvedValue(response({ errors: { name: ['Required'] } }, 422))
        const client = setupClient().throwOnError()

        const error = await client.post('/api/items', {}).catch(e => e)

        expect(error).toBeInstanceOf(HttpRequestError)
        expect(error).toMatchObject({ status: 422, errors: { name: 'Required' } })
    })

    it('rejects a server error with the status and FastAPI detail', async () => {
        requestMock.mockResolvedValue(response({ detail: 'Agent not found' }, 500))
        const client = setupClient().throwOnError()

        const error = await client.get('/api/items/1').catch(e => e)

        expect(error).toBeInstanceOf(HttpRequestError)
        expect(error).toMatchObject({
            status: 500,
            body: { detail: 'Agent not found' },
            detail: 'Agent not found',
            message: 'Agent not found',
        })
    })

    it('rejects a network failure with status 0', async () => {
        const failure = new Error('connection refused')
        requestMock.mockRejectedValue(failure)
        const client = setupClient().throwOnError()

        const error = await client.get('/api/items/1').catch(e => e)

        expect(error).toBeInstanceOf(HttpRequestError)
        expect(error).toMatchObject({ status: 0, cause: failure })
    })

    it('keeps the base client lenient after deriving a throwing one', async () => {
        requestMock.mockResolvedValue(response({ errors: {} }, 422))
        const base = setupClient()
        const throwing = base.throwOnError()

        const lenientResult = base.get<Item>('/api/items/1')

        expectTypeOf(lenientResult).toEqualTypeOf<Promise<Item | undefined>>()
        await expect(lenientResult).resolves.toBeUndefined()
        await expect(throwing.get('/api/items/1')).rejects.toBeInstanceOf(HttpRequestError)
        expect(throwing).not.toBe(base)
        expect(Object.isFrozen(throwing)).toBe(true)
    })

    it('does not carry one call\'s body into the next', async () => {
        requestMock.mockResolvedValue(response({ id: 1 }))
        const client = setupClient().throwOnError()

        await client.post('/api/items', { name: 'first' })
        await client.get('/api/items')

        expect(requestMock).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'get', url: '/api/items' }))
    })
})
