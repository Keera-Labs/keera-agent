import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useRefetchInterval } from '@/composables/useRefetchInterval'

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
export function useAgentCheckin(agentId: MaybeRefOrGetter<number | null>) {
    const queryCache = useQueryCache()
    const key = () => ['agent-checkin', toValue(agentId)]
    const enabled = () => toValue(agentId) !== null

    const query = useQuery({
        key,
        query: async () => {
            const res = await fetch(`/api/agents/${toValue(agentId)}/checkin`)
            if (!res.ok) throw new Error('Failed to fetch check-in state')
            return (await res.json()) as AgentCheckin
        },
        enabled,
    })
    useRefetchInterval(query.refetch, 1000 * 15, enabled)

    const update = useMutation({
        mutation: async (payload: { enabled: boolean; interval_minutes: number }) => {
            const res = await fetch(`/api/agents/${toValue(agentId)}/checkin`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            if (!res.ok) throw new Error('Failed to update check-in state')
            return (await res.json()) as AgentCheckin
        },
        onSuccess: data => queryCache.setQueryData(key(), data),
    })

    return { checkin: query.data, isLoading: query.isLoading, update }
}
