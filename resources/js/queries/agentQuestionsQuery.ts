import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useRefetchInterval } from '@/composables/useRefetchInterval'
import { AGENT_SUMMARIES_QUERY_KEY } from '@/queries/agentSummariesQuery'

export const AGENT_QUESTIONS_QUERY_KEY = ['agent-questions']
const INBOX_QUERY_KEY = [...AGENT_QUESTIONS_QUERY_KEY, 'inbox']

export interface AgentQuestionOption {
    label: string
    description: string | null
    recommended: boolean
}

export type AgentQuestionStatus = 'pending' | 'answered'
export type AgentQuestionKind = 'question' | 'permission'

export interface AgentQuestion {
    id: number
    agent_id: number
    project_id: number | null
    tool_use_id: string | null
    kind: AgentQuestionKind
    question: string
    header: string | null
    options: AgentQuestionOption[]
    multi_select: boolean
    status: AgentQuestionStatus
    answer: string | null
    answered_at: string | null
    created_at: string | null
    agent_name?: string
    agent_type?: string
    agent_model?: string | null
    task_id?: number | null
    worktree?: string | null
    project_name?: string | null
    project_slug?: string | null
}

export interface AgentQuestionAnswer {
    choices: string[]
    text: string
}

interface AgentQuestionResource {
    id: string
    attributes: Omit<AgentQuestion, 'id'>
}

const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/

export function utcTimestamp(value: string | null): string | null {
    if (!value || !NAIVE_TIMESTAMP.test(value)) return value
    return `${value.replace(' ', 'T')}Z`
}

function fromResource({ id, attributes }: AgentQuestionResource): AgentQuestion {
    return {
        ...attributes,
        kind: attributes.kind ?? 'question',
        id: Number(id),
        created_at: utcTimestamp(attributes.created_at),
        answered_at: utcTimestamp(attributes.answered_at),
    }
}

async function fetchQuestions(url: string): Promise<AgentQuestion[]> {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch agent questions')
    const json = await res.json()
    return ((json.data ?? []) as AgentQuestionResource[]).map(fromResource)
}

export function useAgentQuestions(agentIdSource: MaybeRefOrGetter<number | null>) {
    const agentId = () => toValue(agentIdSource)
    const query = useQuery({
        key: () => [...AGENT_QUESTIONS_QUERY_KEY, agentId()],
        query: () => fetchQuestions(`/api/agents/${agentId()}/questions`),
        enabled: () => agentId() !== null,
    })
    const questions = computed(() => query.data.value ?? [])
    const pending = computed(() => questions.value.find(question => question.status === 'pending') ?? null)
    return { questions, pending, isLoading: query.isLoading }
}

export function useInboxQuestions(status: AgentQuestionStatus) {
    const query = useQuery({
        key: [...INBOX_QUERY_KEY, status],
        query: () => fetchQuestions(`/api/agent-questions?status=${status}`),
        staleTime: 1000 * 5,
    })
    useRefetchInterval(query.refetch, 1000 * 10)
    const questions = computed(() => query.data.value ?? [])
    return { questions, isLoading: query.isLoading }
}

async function postAnswer(questionId: number, answer: AgentQuestionAnswer): Promise<AgentQuestion> {
    const res = await fetch(`/api/agent-questions/${questionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answer),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Failed to send the answer')
    return fromResource(json.data)
}

export function useAnswerQuestion() {
    const queryCache = useQueryCache()
    return useMutation({
        mutation: ({ questionId, answer }: { questionId: number; answer: AgentQuestionAnswer }) =>
            postAnswer(questionId, answer),
        onSettled: () => {
            queryCache.invalidateQueries({ key: AGENT_QUESTIONS_QUERY_KEY })
            queryCache.invalidateQueries({ key: AGENT_SUMMARIES_QUERY_KEY })
            queryCache.invalidateQueries({ key: ['agents'] })
        },
    })
}
