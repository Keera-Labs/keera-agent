import { useForm, useHttp } from '@inertiajs/react'

type InertiaPage = { props: Record<string, unknown> }

export function useWorkspace() {
    const createForm = useForm({ name: '', description: '' })
    const updateHttp = useHttp({})
    const destroyHttp = useHttp({})

    // Inertia form post. The server redirects back, so Inertia re-fetches the
    // page and the refreshed workspace list flows in via props automatically.
    const create = (data: { name: string; description?: string }, onSuccess?: (page: InertiaPage) => void) => {
        createForm.setData(data)
        createForm.post('/api/workspaces', { preserveScroll: true, onSuccess })
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
