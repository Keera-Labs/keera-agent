import { useForm, useHttp } from '@inertiajs/react'
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Workspace } from "@/types/type"

export function useWorkspace() {
    const queryClient = useQueryClient()
    const createForm = useForm({ name: '', description: '' })
    const updateHttp = useHttp({})
    const destroyHttp = useHttp({})

    const query = useQuery<Workspace[]>({
        queryKey: ["workspaces"],
        queryFn: async () => {
            const res = await fetch("/api/workspaces")
            if (!res.ok) throw new Error("Failed to fetch workspaces")
            return res.json()
        },
        staleTime: 1000 * 60 * 5,
    })

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["workspaces"] })

    const create = (data: { name: string; description?: string }) => {
        createForm.setData(data)
        createForm.post('/api/workspaces', { onSuccess: invalidate })
    }

    const update = ({ id, ...data }: { id: number; name?: string; description?: string }) => {
        updateHttp.setData(data)
        updateHttp.patch(`/api/workspaces/${id}`, { onSuccess: invalidate })
    }

    const destroy = (id: number) => {
        destroyHttp.delete(`/api/workspaces/${id}`, { onSuccess: invalidate })
    }

    return {
        workspaces: query.data ?? [],
        isLoading: query.isLoading,
        creating: createForm.processing,
        createErrors: createForm.errors,
        updating: updateHttp.processing,
        destroying: destroyHttp.processing,
        error: query.error,
        create,
        update,
        destroy,
        invalidate,
    }
}
