import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { useHttp } from '@inertiajs/vue3'
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

// useHttp rejects on every non-2xx except 422, which it reports via onError and
// then resolves with undefined. Throwing from onError turns that into a rejection
// too, so Colada never caches an undefined result.
function rejectOnValidationError(message: string) {
    return {
        onError: () => {
            throw new Error(message)
        },
    }
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

    // Created here, during setup, rather than inside the query/mutation functions:
    // each useHttp instance owns reactive state and watchers that would leak if
    // created on every poll. Separate instances keep a poll and a toggle from
    // sharing one abort controller and processing flag.
    const fetchRequest = useHttp<Record<string, never>, AgentCheckin>()
    const updateRequest = useHttp<Record<string, never>, AgentCheckin>()

    const query = useQuery({
        key,
        query: () => fetchRequest.get(url(), rejectOnValidationError('Failed to fetch check-in state')),
        enabled,
    })
    useRefetchInterval(query.refetch, 1000 * 15, enabled)

    const update = useMutation({
        mutation: (payload: AgentCheckinPayload) =>
            updateRequest
                .transform(() => payload)
                .patch(url(), rejectOnValidationError('Failed to update check-in state')),
        onSuccess: data => queryCache.setQueryData(key(), data),
    })

    return { checkin: query.data, isLoading: query.isLoading, update }
}
