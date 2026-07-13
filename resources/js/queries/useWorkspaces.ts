import { useForm, useHttp, usePage } from "@inertiajs/react"
import { useQuery } from "@tanstack/react-query"
import type { Workspace } from "@/types/type"

export const WORKSPACES_QUERY_KEY = ["workspaces"] as const

async function fetchWorkspaces(): Promise<Workspace[]> {
    const res = await fetch("/api/workspaces")
    if (!res.ok) throw new Error("Failed to fetch workspaces")
    return res.json()
}

export default function useWorkspaces() {
    const props = usePage<{ workspaces?: Workspace[] }>().props

    const query = useQuery<Workspace[]>({
        queryKey: WORKSPACES_QUERY_KEY,
        queryFn: fetchWorkspaces,
        initialData: props.workspaces,
        staleTime: 1000 * 30,
    })

    return { workspaces: query.data ?? [] }
}

export function useWorkspace() {
    const createForm = useForm({ name: '', description: '' })
    const updateHttp = useHttp({})
    const destroyHttp = useHttp({})

    const create = (data: { name: string; description?: string }, onSuccess?: () => void) => {
        createForm.setData(data)
        createForm.post('/api/workspaces', { onSuccess })
    }

    const update = ({ id, ...data }: { id: number; name?: string; description?: string }, onSuccess?: () => void) => {
        updateHttp.setData(data)
        updateHttp.patch(`/api/workspaces/${id}`, { onSuccess })
    }

    const destroy = (id: number, onSuccess?: () => void) => {
        destroyHttp.delete(`/api/workspaces/${id}`, { onSuccess })
    }

    return {
        creating: createForm.processing,
        createErrors: createForm.errors,
        updating: updateHttp.processing,
        destroying: destroyHttp.processing,
        create,
        update,
        destroy,
    }
}
