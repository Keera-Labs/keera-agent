import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query'

export interface ProjectAgent {
    id: number
    project_id: number
    name: string
    description: string | null
    model: string
    system_prompt: string | null
    agent_type: string
    status: 'idle' | 'running'
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
        staleTime: 1000 * 30,
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
        spawnViaMCP,
    }
}
