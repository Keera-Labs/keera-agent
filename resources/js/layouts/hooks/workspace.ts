import { useForm, useHttp } from '@inertiajs/react'
import { router } from '@inertiajs/react'

export function useWorkspace() {
    const createForm = useForm({ name: '', description: '' })
    const updateHttp = useHttp({})
    const destroyHttp = useHttp({})

    const reload = () => router.reload({ only: ['workspaces', 'projects'] })

    const create = (data: { name: string; description?: string }) => {
        createForm.setData(data)
        createForm.post('/api/workspaces', { onSuccess: reload })
    }

    const update = ({ id, ...data }: { id: number; name?: string; description?: string }) => {
        updateHttp.setData(data)
        updateHttp.patch(`/api/workspaces/${id}`, { onSuccess: reload })
    }

    const destroy = (id: number) => {
        destroyHttp.delete(`/api/workspaces/${id}`, { onSuccess: reload })
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
