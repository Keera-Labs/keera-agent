// @vitest-environment happy-dom
import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { parseTaskPage, useTasks, type TaskCollectionDocument } from './taskQuery'

// Shapes captured from the real API (TaskResource over a LengthAwarePaginator).
function resource(id: number, overrides: Record<string, unknown> = {}) {
    return {
        type: 'tasks',
        id: String(id),
        attributes: {
            id,
            project_id: 1,
            status: 'pending',
            created_at: '2026-09-26T01:47:52',
            updated_at: '2026-09-26T01:47:52',
            title: `Task ${id}`,
            body: 'Details',
            assignees: ['QA'],
            acceptance_criteria: [],
            testing_methods: [],
            validation_steps: [],
            priority: 'medium',
            completed_at: null,
            complexity: null,
            ...overrides,
        },
    }
}

const emptyEnvelope = {
    data: [],
    meta: { total: 0, count: 0, per_page: 15, current_page: 1, last_page: 0, next_page: null, previous_page: null },
}

const firstOfTwoPagesEnvelope = {
    data: Array.from({ length: 15 }, (_, i) => resource(i + 1)),
    meta: { total: 17, count: 15, per_page: 15, current_page: 1, last_page: 2, next_page: 2, previous_page: null },
}

const storeResponse = {
    data: {
        type: 'tasks',
        id: '18',
        attributes: {
            title: 'Write docs', body: 'Details', assignees: ['QA'], priority: 'medium', complexity: null,
            acceptance_criteria: [], testing_methods: [], validation_steps: [], project_id: 1, status: 'pending', id: 18,
        },
    },
}

function jsonResponse(body: unknown, status = 200) {
    return { ok: status < 400, status, json: async () => body }
}

const fetchMock = vi.fn()

function mountUseTasks(projectId: number | null = 1) {
    const id = ref(projectId)
    let api!: ReturnType<typeof useTasks>
    mount(
        defineComponent({
            setup() {
                api = useTasks(id)
                return () => null
            },
        }),
        { global: { plugins: [createPinia(), PiniaColada] } },
    )
    return { api, id }
}

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('parseTaskPage', () => {
    it('unwraps attributes and uses the numeric resource id', () => {
        const page = parseTaskPage(firstOfTwoPagesEnvelope as TaskCollectionDocument)
        expect(page.total).toBe(17)
        expect(page.tasks).toHaveLength(15)
        expect(page.tasks[0]).toMatchObject({ id: 1, title: 'Task 1', status: 'pending', assignees: ['QA'] })
    })

    it('falls back to the item count when meta is absent', () => {
        const page = parseTaskPage({ data: [resource(3)] } as TaskCollectionDocument)
        expect(page).toMatchObject({ total: 1, tasks: [{ id: 3 }] })
    })
})

describe('useTasks', () => {
    it('handles an empty list', async () => {
        fetchMock.mockResolvedValue(jsonResponse(emptyEnvelope))
        const { api } = mountUseTasks()
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/tasks')
        expect(api.tasks.value).toEqual([])
        expect(api.total.value).toBe(0)
        expect(api.hasMore.value).toBe(false)
    })

    it('exposes the first page of a multi-page response and flags the rest', async () => {
        fetchMock.mockResolvedValue(jsonResponse(firstOfTwoPagesEnvelope))
        const { api } = mountUseTasks()
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(api.tasks.value.map(t => t.id)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
        expect(api.total.value).toBe(17)
        expect(api.hasMore.value).toBe(true)
    })

    it('does not fetch without a project', async () => {
        const { api } = mountUseTasks(null)
        await flushPromises()

        expect(fetchMock).not.toHaveBeenCalled()
        expect(api.tasks.value).toEqual([])
    })

    it('appends a created task parsed from the resource document', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(emptyEnvelope))
        const { api } = mountUseTasks()
        await flushPromises()

        fetchMock.mockResolvedValueOnce(jsonResponse(storeResponse, 201))
        await api.create.mutateAsync({ title: 'Write docs', body: 'Details', assignees: ['QA'] })

        expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/1/tasks', expect.objectContaining({ method: 'POST' }))
        expect(api.tasks.value).toEqual([expect.objectContaining({ id: 18, title: 'Write docs' })])
        expect(api.total.value).toBe(1)
    })

    it('replaces an updated task in place', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(firstOfTwoPagesEnvelope))
        const { api } = mountUseTasks()
        await flushPromises()

        fetchMock.mockResolvedValueOnce(jsonResponse({ data: resource(2, { status: 'completed', completed_at: '2026-09-26T02:00:00' }) }))
        await api.updateStatus.mutateAsync({ taskId: 2, status: 'completed' })

        expect(fetchMock).toHaveBeenLastCalledWith('/api/tasks/2', expect.objectContaining({ method: 'PATCH', body: '{"status":"completed"}' }))
        expect(api.tasks.value[1]).toMatchObject({ id: 2, status: 'completed' })
        expect(api.tasks.value).toHaveLength(15)
        expect(api.total.value).toBe(17)
    })

    it('drops a deleted task and decrements the total', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(firstOfTwoPagesEnvelope))
        const { api } = mountUseTasks()
        await flushPromises()

        fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error('no body') } })
        await api.remove.mutateAsync(5)

        expect(api.tasks.value.some(t => t.id === 5)).toBe(false)
        expect(api.total.value).toBe(16)
    })

    it('rejects and keeps the cache when a delete fails', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(firstOfTwoPagesEnvelope))
        const { api } = mountUseTasks()
        await flushPromises()

        fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
        await expect(api.remove.mutateAsync(5)).rejects.toThrow('Failed to delete task')

        expect(api.tasks.value).toHaveLength(15)
    })
})
