import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'
import { router } from '@inertiajs/react'
import type { Project } from '@/types/type'

async function fetchProjects(): Promise<Project[]> {
    const res = await fetch('/api/projects')
    if (!res.ok) throw new Error('Failed to fetch projects')
    return res.json()
}

export function useProjects() {
    const queryClient = useQueryClient()
    const key = ['projects']
    const workspacesKey = ['workspaces']

    const query = useQuery<Project[]>({
        queryKey: key,
        queryFn: fetchProjects,
        staleTime: 1000 * 60 * 5,
    })

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: key })
        queryClient.invalidateQueries({ queryKey: workspacesKey })
    }

    const create = useMutation({
        mutationFn: async (data: { name: string; path: string; language: string; workspace_id: number | null }) => {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.error ?? 'Failed to create project')
            }
            return res.json() as Promise<Project>
        },
        onSuccess: (project) => {
            queryClient.setQueryData<Project[]>(key, prev => [...(prev ?? []), project])
            invalidate()
            router.visit(`/${project.slug}`)
        },
    })

    const update = useMutation({
        mutationFn: async ({ id, ...data }: Partial<Project> & { id: number }) => {
            const res = await fetch(`/api/projects/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.error ?? 'Failed to update project')
            }
            return res.json() as Promise<Project>
        },
        onSuccess: (updated) => {
            queryClient.setQueryData<Project[]>(key, prev =>
                (prev ?? []).map(p => p.id === updated.id ? updated : p)
            )
            invalidate()
        },
    })

    const remove = useMutation({
        mutationFn: async (projectId: number) => {
            const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.error ?? 'Failed to delete project')
            }
            return projectId
        },
        onSuccess: (projectId) => {
            queryClient.setQueryData<Project[]>(key, prev =>
                (prev ?? []).filter(p => p.id !== projectId)
            )
            invalidate()
        },
    })

    const validatePath = async (path: string): Promise<{ exists: boolean; expanded: string }> => {
        const res = await fetch(`/api/validate-path?path=${encodeURIComponent(path)}`)
        return res.json()
    }

    const allProjects = query.data ?? []
    const unassigned = allProjects.filter(p => p.workspace_id == null)

    return {
        allProjects,
        unassigned,
        isLoading: query.isLoading,
        invalidate,
        create,
        update,
        remove,
        validatePath,
    }
}
