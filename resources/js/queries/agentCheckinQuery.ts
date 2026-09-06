import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface AgentCheckin {
    enabled: boolean
    interval_minutes: number
    running: boolean
}

/**
 * Read and toggle the PM check-in scheduler for a single agent. The query
 * polls so the `running` flag reflects the scheduler auto-stopping once no task
 * is in_progress, without the user needing to reload.
 */
export function useAgentCheckin(agentId: number | null) {
    const queryClient = useQueryClient()
    const key = ['agent-checkin', agentId]

    const query = useQuery<AgentCheckin>({
        queryKey: key,
        queryFn: async () => {
            const res = await fetch(`/api/agents/${agentId}/checkin`)
            if (!res.ok) throw new Error('Failed to fetch check-in state')
            return (await res.json()) as AgentCheckin
        },
        enabled: agentId !== null,
        refetchInterval: 1000 * 15,
    })

    const update = useMutation({
        mutationFn: async (payload: { enabled: boolean; interval_minutes: number }) => {
            const res = await fetch(`/api/agents/${agentId}/checkin`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            if (!res.ok) throw new Error('Failed to update check-in state')
            return (await res.json()) as AgentCheckin
        },
        onSuccess: (data) => queryClient.setQueryData(key, data),
    })

    return { checkin: query.data, isLoading: query.isLoading, update }
}
