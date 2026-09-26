import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Task } from '@/types/type'

async function fetchTasks(projectId: number): Promise<Task[]> {
    const res = await fetch(`/api/projects/${projectId}/tasks`)
    if (!res.ok) throw new Error('Failed to fetch tasks')
    return res.json()
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

    const setTasks = (updater: (prev: Task[]) => Task[]) =>
        queryCache.setQueryData<Task[]>(key(), prev => updater(prev ?? []))

    const invalidate = () => queryCache.invalidateQueries({ key: key(), exact: true })

    const create = useMutation({
        mutation: async (data: { title: string; body: string; assignees: string[] }) => {
            const res = await fetch(`/api/projects/${projectId()}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) throw new Error('Failed to create task')
            return res.json() as Promise<Task>
        },
        onSuccess: task => setTasks(prev => [...prev, task]),
    })

    const updateStatus = useMutation({
        mutation: async ({ taskId, status }: { taskId: number; status: Task['status'] }) => {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })
            if (!res.ok) throw new Error('Failed to update task')
            return res.json() as Promise<Task>
        },
        onSuccess: updated => setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t))),
    })

    const remove = useMutation({
        mutation: async (taskId: number) => {
            await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            return taskId
        },
        onSuccess: taskId => setTasks(prev => prev.filter(t => t.id !== taskId)),
    })

    return {
        tasks: computed(() => query.data.value ?? []),
        isLoading: query.isLoading,
        invalidate,
        create,
        updateStatus,
        remove,
    }
}
