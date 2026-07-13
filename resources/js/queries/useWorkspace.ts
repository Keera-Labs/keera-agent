import { useForm, useHttp } from '@inertiajs/react'

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
