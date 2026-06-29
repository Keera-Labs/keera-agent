import { useState } from 'react'
import { useHttp } from '@inertiajs/react'
import type { Workspace } from '@/types/type'

export function useWorkspace() {
    const [creating, setCreating] = useState(false)
    const updateHttp = useHttp({})
    const destroyHttp = useHttp({})

    // Plain fetch (not an Inertia form) so we get the created workspace back and
    // can select it — mirrors the project create flow in ProjectCreateModal.
    const create = async (data: { name: string; description?: string }): Promise<Workspace> => {
        setCreating(true)
        try {
            const res = await fetch('/api/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json?.error ?? 'Failed to create workspace')
            return json as Workspace
        } finally {
            setCreating(false)
        }
    }

    const update = ({ id, ...data }: { id: number; name?: string; description?: string }, onSuccess?: () => void) => {
        updateHttp.setData(data)
        updateHttp.patch(`/api/workspaces/${id}`, { onSuccess })
    }

    const destroy = (id: number, onSuccess?: () => void) => {
        destroyHttp.delete(`/api/workspaces/${id}`, { onSuccess })
    }

    return {
        creating,
        updating: updateHttp.processing,
        destroying: destroyHttp.processing,
        create,
        update,
        destroy,
    }
}
