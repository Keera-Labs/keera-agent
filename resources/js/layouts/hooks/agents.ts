import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'

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
    model: string
    system_prompt: string | null
    agent_type: string
    status: 'idle' | 'running'
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

export function useAgents(projectId: number | null) {
    const queryClient = useQueryClient()
    const key = ['agents', projectId]

    const query = useQuery<ProjectAgent[]>({
        queryKey: key,
        queryFn: () => fetchAgents(projectId!),
        enabled: projectId !== null,
        staleTime: 1000 * 10,
        refetchInterval: 1000 * 10,
    })

    const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

    const addAgent = (agent: ProjectAgent) => {
        queryClient.setQueryData<ProjectAgent[]>(key, prev => {
            if ((prev ?? []).some(a => a.id === agent.id)) return prev ?? []
            return [...(prev ?? []), agent]
        })
    }

    const create = useMutation({
        mutationFn: async (data: Partial<ProjectAgent> & { name: string }) => {
            const res = await fetch(`/api/projects/${projectId}/agents`, {
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
        mutationFn: async (agentId: number) => {
            const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Failed to delete agent')
            return agentId
        },
        onSuccess: (agentId) => {
            queryClient.setQueryData<ProjectAgent[]>(key, prev =>
                (prev ?? []).filter(a => a.id !== agentId)
            )
        },
    })

    const update = useMutation({
        mutationFn: async ({
            agentId,
            ...fields
        }: { agentId: number } & Partial<Pick<ProjectAgent, 'name' | 'description' | 'agent_type' | 'model' | 'system_prompt'> & { flags: AgentFlags }>) => {
            const res = await fetch(`/api/agents/${agentId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            })
            if (!res.ok) throw new Error('Failed to update agent')
            const json = await res.json()
            return normalizeAgent(json.data as AgentResource)
        },
        onSuccess: (updated) => {
            queryClient.setQueryData<ProjectAgent[]>(key, prev =>
                (prev ?? []).map(a => a.id === updated.id ? { ...a, ...updated } : a)
            )
        },
    })

    const setDefault = async (agentId: number): Promise<boolean> => {
        const res = await fetch(`/api/projects/${projectId}/default-agent`, {
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
        agents: query.data ?? [],
        isLoading: query.isLoading,
        invalidate,
        addAgent,
        create,
        remove,
        update,
        setDefault,
        spawnViaMCP,
    }
}
