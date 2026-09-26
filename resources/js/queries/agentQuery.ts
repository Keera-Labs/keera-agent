import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useRefetchInterval } from '@/composables/useRefetchInterval'
import { AGENT_SUMMARIES_QUERY_KEY } from '@/queries/agentSummariesQuery'

export interface AgentFlags {
    dangerously_skip_permissions?: boolean
    plan_mode?: boolean
    verbose?: boolean
    max_turns?: number | null
}

export interface ProjectAgent {
    id: number
    project_id: number
    name: string
    slug: string
    description: string | null
    provider: string
    model: string
    system_prompt: string | null
    agent_type: string
    status: 'idle' | 'running' | 'waiting'
    flags: AgentFlags
    dangerously_skip_permissions: boolean
    plan_mode: boolean
    task_id?: number | null
    created_at: string | null
}

/** A single JSON:API resource object: { type, id, attributes }. */
export interface AgentResource {
    type: string
    id: string
    attributes: Record<string, unknown>
}

/**
 * Flatten a JSON:API agent resource into a ProjectAgent.
 * The backend returns raw DB columns in `attributes`, so `flags` arrives as a
 * JSON string and the boolean flags as 0/1 integers — normalize them here.
 */
export function normalizeAgent(resource: AgentResource): ProjectAgent {
    const attr = resource.attributes ?? {}

    let flags: AgentFlags = {}
    if (typeof attr.flags === 'string') {
        try {
            flags = (JSON.parse(attr.flags) as AgentFlags) ?? {}
        } catch {
            flags = {}
        }
    } else if (attr.flags && typeof attr.flags === 'object') {
        flags = attr.flags as AgentFlags
    }

    return {
        id: Number(resource.id ?? attr.id),
        project_id: attr.project_id as number,
        name: attr.name as string,
        slug: attr.slug as string,
        description: (attr.description as string | null) ?? null,
        provider: (attr.provider as string) || 'claude',
        model: attr.model as string,
        system_prompt: (attr.system_prompt as string | null) ?? null,
        agent_type: attr.agent_type as string,
        status: attr.status as ProjectAgent['status'],
        flags,
        dangerously_skip_permissions: Boolean(attr.dangerously_skip_permissions),
        plan_mode: Boolean(attr.plan_mode),
        task_id: (attr.task_id as number | null) ?? null,
        created_at: (attr.created_at as string | null) ?? null,
    }
}

async function fetchAgents(projectId: number): Promise<ProjectAgent[]> {
    const res = await fetch(`/api/projects/${projectId}/agents`)
    if (!res.ok) throw new Error('Failed to fetch agents')
    const json = await res.json()
    return ((json.data ?? []) as AgentResource[]).map(normalizeAgent)
}

export function useAgents(projectIdSource: MaybeRefOrGetter<number | null>) {
    const queryCache = useQueryCache()
    const projectId = () => toValue(projectIdSource)
    const key = () => ['agents', projectId()]
    const enabled = () => projectId() !== null

    const query = useQuery({
        key,
        query: () => fetchAgents(projectId()!),
        enabled,
        staleTime: 1000 * 10,
    })
    useRefetchInterval(query.refetch, 1000 * 10, enabled)

    // The sidebar lists every project's agents from its own query, so each local change refreshes it too.
    const setAgents = (updater: (prev: ProjectAgent[]) => ProjectAgent[]) => {
        queryCache.setQueryData<ProjectAgent[]>(key(), prev => updater(prev ?? []))
        queryCache.invalidateQueries({ key: AGENT_SUMMARIES_QUERY_KEY })
    }

    const invalidate = () => queryCache.invalidateQueries({ key: key(), exact: true })

    const addAgent = (agent: ProjectAgent) =>
        setAgents(prev => (prev.some(a => a.id === agent.id) ? prev : [...prev, agent]))

    const create = useMutation({
        mutation: async (data: Partial<ProjectAgent> & { name: string }) => {
            const res = await fetch(`/api/projects/${projectId()}/agents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) throw new Error('Failed to create agent')
            const json = await res.json()
            return normalizeAgent(json.data as AgentResource)
        },
        onSuccess: addAgent,
    })

    const remove = useMutation({
        mutation: async (agentId: number) => {
            const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Failed to delete agent')
            return agentId
        },
        onSuccess: agentId => setAgents(prev => prev.filter(a => a.id !== agentId)),
    })

    const update = useMutation({
        mutation: async ({
            agentId,
            ...fields
        }: { agentId: number } & Partial<Pick<ProjectAgent, 'name' | 'description' | 'agent_type' | 'provider' | 'model' | 'system_prompt'> & { flags: AgentFlags }>) => {
            const res = await fetch(`/api/agents/${agentId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            })
            if (!res.ok) throw new Error('Failed to update agent')
            const json = await res.json()
            return normalizeAgent(json.data as AgentResource)
        },
        onSuccess: updated => setAgents(prev => prev.map(a => (a.id === updated.id ? { ...a, ...updated } : a))),
    })

    const adoptWork = useMutation({
        mutation: async (agentId: number) => {
            const res = await fetch(`/api/agents/${agentId}/adopt-work`, { method: 'POST' })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) {
                throw new Error((json as { error?: string }).error || 'Failed to adopt agent work')
            }
            return json as { ok: boolean; branch: string; worktree: string }
        },
    })

    const setDefault = async (agentId: number): Promise<boolean> => {
        const res = await fetch(`/api/projects/${projectId()}/default-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agentId }),
        })
        return res.ok
    }

    const spawnViaMCP = async (
        projectPath: string,
        name: string,
        agentType: string,
        message: string,
        complexity: string,
        taskId?: number,
    ): Promise<{ success: boolean; text: string }> => {
        const res = await fetch('/mcp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Project-Path': projectPath,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: {
                    name: 'spawn_agent',
                    arguments: {
                        project_path: projectPath,
                        name,
                        agent_type: agentType,
                        message,
                        complexity,
                        ...(taskId != null ? { task_id: taskId } : {}),
                    },
                },
            }),
        })
        const data = await res.json()
        const text: string = data?.result?.content?.[0]?.text ?? data?.error?.message ?? 'Unknown response'
        return { success: !data.error, text }
    }

    return {
        agents: computed(() => query.data.value ?? []),
        isLoading: query.isLoading,
        // True only until the first load resolves; isLoading also covers background refetches.
        isPending: computed(() => query.status.value === 'pending'),
        invalidate,
        addAgent,
        create,
        remove,
        update,
        adoptWork,
        setDefault,
        spawnViaMCP,
    }
}
