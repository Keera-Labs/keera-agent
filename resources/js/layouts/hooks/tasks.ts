import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'
import type { Task } from '@/types/type'

// ─── API response shapes ──────────────────────────────────────────────────────

interface TaskJsonApiItem {
    type: string
    id: string
    attributes: Task
}

interface TasksPage {
    data: TaskJsonApiItem[]
    meta: { total: number; count: number; per_page: number; current_page: number; last_page: number }
}

// Cache shape: flat tasks array + server-reported total (after the 7-day
// completed-task filter).  We keep them together so invalidation keeps both
// in sync with a single query key.
interface TasksCacheEntry {
    tasks: Task[]
    totalCount: number
}

async function fetchTasks(projectId: number): Promise<TasksCacheEntry> {
    const res = await fetch(`/api/projects/${projectId}/tasks`)
    if (!res.ok) throw new Error('Failed to fetch tasks')
    const json: TasksPage = await res.json()
    const tasks: Task[] = (json.data ?? []).map(item => item.attributes)
    const totalCount: number = json.meta?.total ?? tasks.length
    return { tasks, totalCount }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTasks(projectId: number | null) {
    const queryClient = useQueryClient()
    const key = ['tasks', projectId]

    const query = useQuery<TasksCacheEntry>({
        queryKey: key,
        queryFn: () => fetchTasks(projectId!),
        enabled: projectId !== null,
        staleTime: 1000 * 30,
    })

    const tasks: Task[] = query.data?.tasks ?? []
    const totalCount: number = query.data?.totalCount ?? 0

    const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

    const create = useMutation({
        mutationFn: async (data: { title: string; body: string; assignees: string[] }) => {
            const res = await fetch(`/api/projects/${projectId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) throw new Error('Failed to create task')
            // store endpoint returns a single JSON:API resource: {data: {attributes: Task}}
            const json: { data: TaskJsonApiItem } = await res.json()
            return json.data.attributes
        },
        onSuccess: (task: Task) => {
            queryClient.setQueryData<TasksCacheEntry>(key, prev => prev
                ? { tasks: [...prev.tasks, task], totalCount: prev.totalCount + 1 }
                : { tasks: [task], totalCount: 1 })
        },
    })

    const updateStatus = useMutation({
        mutationFn: async ({ taskId, status }: { taskId: number; status: Task['status'] }) => {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })
            if (!res.ok) throw new Error('Failed to update task')
            // update endpoint returns a single JSON:API resource
            const json: { data: TaskJsonApiItem } = await res.json()
            return json.data.attributes
        },
        onSuccess: (updated: Task) => {
            queryClient.setQueryData<TasksCacheEntry>(key, prev => prev
                ? { ...prev, tasks: prev.tasks.map(t => t.id === updated.id ? updated : t) }
                : { tasks: [updated], totalCount: 1 })
        },
    })

    const remove = useMutation({
        mutationFn: async (taskId: number) => {
            await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            return taskId
        },
        onSuccess: (taskId: number) => {
            queryClient.setQueryData<TasksCacheEntry>(key, prev => prev
                ? { tasks: prev.tasks.filter(t => t.id !== taskId), totalCount: Math.max(0, prev.totalCount - 1) }
                : { tasks: [], totalCount: 0 })
        },
    })

    return {
        tasks,
        totalCount,
        isLoading: query.isLoading,
        invalidate,
        create,
        updateStatus,
        remove,
    }
}
