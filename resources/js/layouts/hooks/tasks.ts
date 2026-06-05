import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'
import type { Task } from '@/types/type'

async function fetchTasks(projectId: number): Promise<Task[]> {
    const res = await fetch(`/api/projects/${projectId}/tasks`)
    if (!res.ok) throw new Error('Failed to fetch tasks')
    return res.json()
}

export function useTasks(projectId: number | null) {
    const queryClient = useQueryClient()
    const key = ['tasks', projectId]

    const query = useQuery<Task[]>({
        queryKey: key,
        queryFn: () => fetchTasks(projectId!),
        enabled: projectId !== null,
        staleTime: 1000 * 30,
    })

    const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

    const create = useMutation({
        mutationFn: async (data: { title: string; body: string; assignees: string[] }) => {
            const res = await fetch(`/api/projects/${projectId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) throw new Error('Failed to create task')
            return res.json() as Promise<Task>
        },
        onSuccess: (task) => {
            queryClient.setQueryData<Task[]>(key, prev => [...(prev ?? []), task])
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
            return res.json() as Promise<Task>
        },
        onSuccess: (updated) => {
            queryClient.setQueryData<Task[]>(key, prev =>
                (prev ?? []).map(t => t.id === updated.id ? updated : t)
            )
        },
    })

    const remove = useMutation({
        mutationFn: async (taskId: number) => {
            await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            return taskId
        },
        onSuccess: (taskId) => {
            queryClient.setQueryData<Task[]>(key, prev =>
                (prev ?? []).filter(t => t.id !== taskId)
            )
        },
    })

    return {
        tasks: query.data ?? [],
        isLoading: query.isLoading,
        invalidate,
        create,
        updateStatus,
        remove,
    }
}
