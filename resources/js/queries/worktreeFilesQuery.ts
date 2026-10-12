import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'

type WorktreeFilesDocument = { data: { paths: string[] } }

export const worktreeFilesKey = (projectId: number) => ['worktree-files', projectId]

const url = (projectId: number) => `/api/projects/${projectId}/worktree-files`

function validationMessage(body: unknown): string | undefined {
    const detail = (body as { detail?: { msg?: string }[] } | null)?.detail
    return Array.isArray(detail) ? detail[0]?.msg?.replace(/^Value error, /, '') : undefined
}

export async function fetchWorktreeFiles(projectId: number): Promise<string[]> {
    const res = await fetch(url(projectId), { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error('Failed to load worktree files')
    return ((await res.json()) as WorktreeFilesDocument).data.paths
}

export async function saveWorktreeFiles(projectId: number, paths: string[]): Promise<string[]> {
    const res = await fetch(url(projectId), {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(validationMessage(body) ?? 'Failed to save worktree files')
    return (body as WorktreeFilesDocument).data.paths
}

export function useWorktreeFiles(projectId: MaybeRefOrGetter<number>) {
    const queryCache = useQueryCache()

    const query = useQuery({
        key: () => worktreeFilesKey(toValue(projectId)),
        query: () => fetchWorktreeFiles(toValue(projectId)),
    })

    const save = useMutation({
        mutation: (paths: string[]) => saveWorktreeFiles(toValue(projectId), paths),
        onSuccess: paths => queryCache.setQueryData(worktreeFilesKey(toValue(projectId)), paths),
    })

    return { paths: query.data, isLoading: query.isLoading, refetch: query.refetch, save: save.mutateAsync }
}
