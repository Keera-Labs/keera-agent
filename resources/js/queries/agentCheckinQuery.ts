import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useHttp } from '@/composables/useHttp'
import { useRefetchInterval } from '@/composables/useRefetchInterval'

export interface AgentCheckin {
    enabled: boolean
    interval_minutes: number
    running: boolean
}

export interface AgentCheckinPayload {
    enabled: boolean
    interval_minutes: number
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
    const url = () => `/api/agents/${toValue(agentId)}/checkin`

    // Separate clients so a poll and a toggle don't share one abort controller.
    const fetchRequest = useHttp().throwOnError()
    const updateRequest = useHttp().throwOnError()

    const query = useQuery({
        key,
        query: () => fetchRequest.get<AgentCheckin>(url()),
        enabled,
    })
    useRefetchInterval(query.refetch, 1000 * 15, enabled)

    const update = useMutation({
        mutation: (payload: AgentCheckinPayload) => updateRequest.patch<AgentCheckin>(url(), payload),
        onSuccess: data => queryCache.setQueryData(key(), data),
    })

    return { checkin: query.data, isLoading: query.isLoading, update }
}
