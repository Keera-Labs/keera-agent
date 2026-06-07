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
    task_id?: number | null
    created_at: string | null
}

async function fetchAgents(projectId: number): Promise<ProjectAgent[]> {
    const res = await fetch(`/api/projects/${projectId}/agents`)
    if (!res.ok) throw new Error('Failed to fetch agents')
    return res.json()
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
            return res.json() as Promise<ProjectAgent>
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
        }: { agentId: number } & Partial<Pick<ProjectAgent, 'name' | 'model' | 'system_prompt'> & { flags: AgentFlags }>) => {
            const res = await fetch(`/api/agents/${agentId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            })
            if (!res.ok) throw new Error('Failed to update agent')
            return res.json() as Promise<ProjectAgent>
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
