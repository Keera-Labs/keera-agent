import { usePage } from "@inertiajs/vue3"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import { computed } from "vue"
import type { Workspace } from "@/types/type"

export const WORKSPACES_QUERY_KEY = ["workspaces"]

type WorkspaceFields = { name?: string; description?: string }

async function fetchWorkspaces(): Promise<Workspace[]> {
    const res = await fetch("/api/workspaces")
    if (!res.ok) throw new Error("Failed to fetch workspaces")
    return res.json()
}

async function sendWorkspace(url: string, method: "POST" | "PATCH" | "DELETE", body?: WorkspaceFields) {
    const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`Failed to ${method.toLowerCase()} workspace`)
}

export default function useWorkspaces() {
    const page = usePage<{ workspaces?: Workspace[] }>()
    const queryCache = useQueryCache()

    const query = useQuery({
        key: WORKSPACES_QUERY_KEY,
        query: fetchWorkspaces,
        initialData: () => page.props.workspaces,
        staleTime: 1000 * 30,
    })

    const invalidate = () => queryCache.invalidateQueries({ key: WORKSPACES_QUERY_KEY })

    const createMutation = useMutation({
        mutation: (data: { name: string; description?: string }) => sendWorkspace("/api/workspaces", "POST", data),
        onSuccess: invalidate,
    })
    const updateMutation = useMutation({
        mutation: ({ id, ...data }: { id: number } & WorkspaceFields) =>
            sendWorkspace(`/api/workspaces/${id}`, "PATCH", data),
        onSuccess: invalidate,
    })
    const destroyMutation = useMutation({
        mutation: (id: number) => sendWorkspace(`/api/workspaces/${id}`, "DELETE"),
        onSuccess: invalidate,
    })

    const create = (data: { name: string; description?: string }, onSuccess?: () => void) =>
        createMutation.mutateAsync(data).then(onSuccess)

    const update = (data: { id: number } & WorkspaceFields, onSuccess?: () => void) =>
        updateMutation.mutateAsync(data).then(onSuccess)

    const destroy = (id: number, onSuccess?: () => void) =>
        destroyMutation.mutateAsync(id).then(onSuccess)

    return {
        workspaces: computed(() => query.data.value ?? []),
        creating: createMutation.isLoading,
        updating: updateMutation.isLoading,
        destroying: destroyMutation.isLoading,
        create,
        update,
        destroy,
    }
}
