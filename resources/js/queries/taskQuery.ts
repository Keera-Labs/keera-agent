import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Task } from '@/types/type'

// JSON:API documents produced by TaskResource (app/resources/task_resource.py).
export type TaskResourceObject = { type: 'tasks'; id: string; attributes: Task }

export type TaskDocument = { data: TaskResourceObject }

// Pagination meta of a LengthAwarePaginator collection.
export type PaginationMeta = {
    total: number
    count: number
    per_page: number
    current_page: number
    last_page: number
    next_page: number | null
    previous_page: number | null
}

export type TaskCollectionDocument = { data: TaskResourceObject[]; meta?: PaginationMeta }

/** The first page of a project's tasks plus the project's total task count. */
export type TaskPage = { tasks: Task[]; total: number }

export function parseTask(resource: TaskResourceObject): Task {
    return { ...resource.attributes, id: Number(resource.id) }
}

export function parseTaskPage(document: TaskCollectionDocument): TaskPage {
    const tasks = document.data.map(parseTask)
    return { tasks, total: document.meta?.total ?? tasks.length }
}

async function fetchTasks(projectId: number): Promise<TaskPage> {
    const res = await fetch(`/api/projects/${projectId}/tasks`)
    if (!res.ok) throw new Error('Failed to fetch tasks')
    return parseTaskPage(await res.json())
}

async function sendTask(url: string, method: 'POST' | 'PATCH', body: object): Promise<Task> {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Failed to ${method === 'POST' ? 'create' : 'update'} task`)
    const document: TaskDocument = await res.json()
    return parseTask(document.data)
}

export function useTasks(projectIdSource: MaybeRefOrGetter<number | null>) {
    const queryCache = useQueryCache()
    const projectId = () => toValue(projectIdSource)
    const key = () => ['tasks', projectId()]

    const query = useQuery({
        key,
        query: () => fetchTasks(projectId()!),
        enabled: () => projectId() !== null,
        staleTime: 1000 * 30,
    })

    // Keeps `total` in step with local additions/removals so `hasMore` stays right.
    const setTasks = (updater: (prev: Task[]) => Task[]) =>
        queryCache.setQueryData<TaskPage>(key(), prev => {
            const before = prev?.tasks ?? []
            const tasks = updater(before)
            return { tasks, total: (prev?.total ?? before.length) + tasks.length - before.length }
        })

    const invalidate = () => queryCache.invalidateQueries({ key: key(), exact: true })

    const create = useMutation({
        mutation: (data: { title: string; body: string; assignees: string[] }) =>
            sendTask(`/api/projects/${projectId()}/tasks`, 'POST', data),
        onSuccess: task => setTasks(prev => [...prev, task]),
    })

    const updateStatus = useMutation({
        mutation: ({ taskId, status }: { taskId: number; status: Task['status'] }) =>
            sendTask(`/api/tasks/${taskId}`, 'PATCH', { status }),
        onSuccess: updated => setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t))),
    })

    const remove = useMutation({
        mutation: async (taskId: number) => {
            const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Failed to delete task')
            return taskId
        },
        onSuccess: taskId => setTasks(prev => prev.filter(t => t.id !== taskId)),
    })

    const tasks = computed<Task[]>(() => query.data.value?.tasks ?? [])
    const total = computed<number>(() => query.data.value?.total ?? 0)

    return {
        tasks,
        total,
        // The API serves a single page and ignores ?page=, so later pages cannot be fetched.
        hasMore: computed<boolean>(() => total.value > tasks.value.length),
        isLoading: query.isLoading,
        invalidate,
        create,
        updateStatus,
        remove,
    }
}
