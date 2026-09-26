import { useQuery } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useRefetchInterval } from '@/composables/useRefetchInterval'
import type { AgentResource, ProjectAgent } from '@/queries/agentQuery'

export const AGENT_SUMMARIES_QUERY_KEY = ['agent-summaries']

export interface AgentSummary {
    id: number
    project_id: number
    name: string
    provider: string
    agent_type: string
    status: ProjectAgent['status']
    attention_kind: ProjectAgent['attention_kind']
    attention_prompt: string | null
    last_message: string | null
    last_activity_at: string | null
}

async function fetchAgentSummaries(projectIds: number[]): Promise<AgentSummary[]> {
    const params = new URLSearchParams(projectIds.map(id => ['project_ids', String(id)]))
    const res = await fetch(`/api/agent-summaries?${params}`)
    if (!res.ok) throw new Error('Failed to fetch agent summaries')
    const json = await res.json()
    return ((json.data ?? []) as AgentResource[]).map(({ id, attributes }) => ({
        ...(attributes as Omit<AgentSummary, 'id'>),
        id: Number(id),
    }))
}

/** Every agent of the given projects in one request, polled so statuses stay live. */
export function useAgentSummaries(projectIdsSource: MaybeRefOrGetter<number[]>) {
    const projectIds = () => toValue(projectIdsSource)
    const enabled = () => projectIds().length > 0

    const query = useQuery({
        key: () => [...AGENT_SUMMARIES_QUERY_KEY, projectIds().join(',')],
        query: () => fetchAgentSummaries(projectIds()),
        enabled,
        staleTime: 1000 * 5,
    })
    useRefetchInterval(query.refetch, 1000 * 10, enabled)

    const agentsByProject = computed(() => {
        const grouped = new Map<number, AgentSummary[]>()
        for (const agent of query.data.value ?? []) {
            const list = grouped.get(agent.project_id) ?? []
            list.push(agent)
            grouped.set(agent.project_id, list)
        }
        return grouped
    })

    return { agentsByProject }
}
