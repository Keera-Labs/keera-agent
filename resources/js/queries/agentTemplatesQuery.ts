import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentTemplate } from '@/types/agent'

async function fetchAgentTemplates(): Promise<AgentTemplate[]> {
    const res = await fetch('/api/agent-templates')
    if (!res.ok) throw new Error('Failed to fetch agent templates')
    return res.json()
}

export function useAgentTemplates() {
    const query = useQuery<AgentTemplate[]>({
        queryKey: ['agent-templates'],
        queryFn: fetchAgentTemplates,
        staleTime: 1000 * 60 * 5, // 5 minutes
    })

    // Local setter for optimistic updates (e.g. after create/update/delete)
    const [localTemplates, setLocalTemplates] = useState<AgentTemplate[] | null>(null)

    const agentTemplates = localTemplates ?? query.data ?? []

    function setAgentTemplates(templates: AgentTemplate[]) {
        setLocalTemplates(templates)
    }

    return {
        agentTemplates,
        setAgentTemplates,
        isLoading: query.isLoading,
    }
}
