import { useQuery } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

export const AGENT_QUESTIONS_QUERY_KEY = ['agent-questions']

export interface AgentQuestionOption {
    label: string
    description: string | null
}

export type AgentQuestionStatus = 'pending' | 'answered'

export interface AgentQuestion {
    id: number
    agent_id: number
    tool_use_id: string | null
    question: string
    header: string | null
    options: AgentQuestionOption[]
    multi_select: boolean
    status: AgentQuestionStatus
    answer: string | null
    answered_at: string | null
    created_at: string | null
}

interface AgentQuestionResource {
    id: string
    attributes: Omit<AgentQuestion, 'id'>
}

async function fetchAgentQuestions(agentId: number): Promise<AgentQuestion[]> {
    const res = await fetch(`/api/agents/${agentId}/questions`)
    if (!res.ok) throw new Error('Failed to fetch agent questions')
    const json = await res.json()
    return ((json.data ?? []) as AgentQuestionResource[]).map(resource => ({
        ...resource.attributes,
        id: Number(resource.id),
    }))
}

export function useAgentQuestions(agentIdSource: MaybeRefOrGetter<number | null>) {
    const agentId = () => toValue(agentIdSource)
    const query = useQuery({
        key: () => [...AGENT_QUESTIONS_QUERY_KEY, agentId()],
        query: () => fetchAgentQuestions(agentId()!),
        enabled: () => agentId() !== null,
    })
    const questions = computed(() => query.data.value ?? [])
    return { questions, isLoading: query.isLoading }
}
