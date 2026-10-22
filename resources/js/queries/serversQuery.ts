import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed } from 'vue'

export const SERVERS_QUERY_KEY = ['servers']

export type ServerKind = 'local' | 'cloud'

export interface KeeraServer {
    id: number
    name: string
    kind: ServerKind
    base_url: string
    has_token: boolean
}

export interface ServerInput {
    name: string
    kind: ServerKind
    base_url: string
    token?: string
}

interface ServerResource {
    id: string | number
    attributes: Record<string, unknown>
}

export function normalizeServer(resource: ServerResource): KeeraServer {
    const attr = resource.attributes ?? {}
    return {
        id: Number(resource.id ?? attr.id),
        name: String(attr.name ?? ''),
        kind: attr.kind === 'cloud' ? 'cloud' : 'local',
        base_url: String(attr.base_url ?? ''),
        has_token: Boolean(attr.has_token),
    }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: string; detail?: { msg?: string }[] } | null
    return body?.error ?? body?.detail?.[0]?.msg ?? fallback
}

async function sendServer(url: string, method: string, body: Partial<ServerInput>): Promise<KeeraServer> {
    const res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await errorMessage(res, 'Failed to save the server'))
    const json = (await res.json()) as { data: ServerResource }
    return normalizeServer(json.data)
}

async function fetchServers(): Promise<KeeraServer[]> {
    const res = await fetch('/api/servers', { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error('Failed to fetch servers')
    const json = (await res.json()) as { data?: ServerResource[] }
    return (json.data ?? []).map(normalizeServer)
}

export function useServers() {
    const queryCache = useQueryCache()
    const query = useQuery({ key: SERVERS_QUERY_KEY, query: fetchServers, staleTime: 1000 * 60 })
    const invalidate = () => queryCache.invalidateQueries({ key: SERVERS_QUERY_KEY })

    const create = useMutation({
        mutation: (input: ServerInput) => sendServer('/api/servers', 'POST', input),
        onSettled: invalidate,
    })

    const update = useMutation({
        mutation: ({ id, ...input }: Partial<ServerInput> & { id: number }) =>
            sendServer(`/api/servers/${id}`, 'PATCH', input),
        onSettled: invalidate,
    })

    const remove = useMutation({
        mutation: async (id: number) => {
            const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error(await errorMessage(res, 'Failed to remove the server'))
            return id
        },
        onSettled: invalidate,
    })

    return {
        servers: computed(() => query.data.value ?? []),
        isPending: computed(() => query.status.value === 'pending'),
        error: query.error,
        create,
        update,
        remove,
    }
}
