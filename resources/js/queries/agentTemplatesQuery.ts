import { useQuery, useQueryCache } from '@pinia/colada'
import { computed } from 'vue'
import type { AgentTemplate } from '@/types/agent'

const AGENT_TEMPLATES_QUERY_KEY = ['agent-templates']

async function fetchAgentTemplates(): Promise<AgentTemplate[]> {
    const res = await fetch('/api/agent-templates')
    if (!res.ok) throw new Error('Failed to fetch agent templates')
    return res.json()
}

export function useAgentTemplates() {
    const queryCache = useQueryCache()
    const query = useQuery({
        key: AGENT_TEMPLATES_QUERY_KEY,
        query: fetchAgentTemplates,
        staleTime: 1000 * 60 * 5,
    })

    // Written into the shared cache (not local state) so every consumer sees
    // the result of a create/update/delete without a refetch.
    function setAgentTemplates(templates: AgentTemplate[]) {
        queryCache.setQueryData(AGENT_TEMPLATES_QUERY_KEY, templates)
    }

    return {
        agentTemplates: computed(() => query.data.value ?? []),
        setAgentTemplates,
        isLoading: query.isLoading,
        refetch: query.refetch,
    }
}
