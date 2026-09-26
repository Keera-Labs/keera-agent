import { useHttp } from '@inertiajs/vue3'
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
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

    // One instance per independent request, so the poll and the toggle never share processing state or an abort controller.
    const fetchRequest = useHttp<Record<string, never>, AgentCheckin>()
    const updateRequest = useHttp<AgentCheckinPayload, AgentCheckin>({ enabled: false, interval_minutes: 5 })

    const query = useQuery({
        key,
        query: () => fetchRequest.get(url()),
        enabled,
    })
    useRefetchInterval(query.refetch, 1000 * 15, enabled)

    const update = useMutation({
        mutation: (payload: AgentCheckinPayload) => {
            Object.assign(updateRequest, payload)
            return updateRequest.patch(url(), {
                // Inertia resolves a 422 with undefined; throwing here rejects the mutation so it is never cached.
                onError: errors => {
                    throw new Error('Check-in update failed validation', { cause: errors })
                },
            })
        },
        onSuccess: data => queryCache.setQueryData(key(), data),
    })

    return { checkin: query.data, isLoading: query.isLoading, update }
}
