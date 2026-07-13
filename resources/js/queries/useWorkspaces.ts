import { usePage } from "@inertiajs/react"
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
