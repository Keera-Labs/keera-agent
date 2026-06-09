import { useMutation } from '@tanstack/react-query'
import { router } from '@inertiajs/react'
import type { Project } from '@/types/type'

const reload = () => router.reload({ only: ['workspaces', 'projects'] })

export function useProjects() {
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
        onSuccess: reload,
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
        onSuccess: reload,
    })

    const validatePath = async (path: string): Promise<{ exists: boolean; expanded: string }> => {
        const res = await fetch(`/api/validate-path?path=${encodeURIComponent(path)}`)
        return res.json()
    }

    return {
        isLoading: false,
        create,
        update,
        remove,
        validatePath,
    }
}
