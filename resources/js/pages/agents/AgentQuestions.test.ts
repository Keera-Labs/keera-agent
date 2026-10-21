// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentQuestions from './AgentQuestions.vue'
import { installPinia, stubFetch } from './testing'

function questionResource(id: number, attributes: Record<string, unknown>) {
    return {
        type: 'agent_questions',
        id: String(id),
        attributes: {
            agent_id: 11,
            tool_use_id: 'toolu_1',
            header: null,
            options: [],
            multi_select: false,
            status: 'pending',
            answer: null,
            answered_at: null,
            created_at: null,
            ...attributes,
        },
    }
}

const database = questionResource(1, {
    question: 'Which database?',
    header: 'DB',
    options: [
        { label: 'Postgres', description: 'PostgreSQL relational database' },
        { label: 'SQLite', description: 'Embedded file-based database' },
    ],
})

const extras = questionResource(2, {
    question: 'Which extras?',
    header: 'Extras',
    multi_select: true,
    status: 'answered',
    answer: 'Redis, S3',
    options: [
        { label: 'Redis', description: null },
        { label: 'Kafka', description: null },
        { label: 'S3', description: null },
    ],
})

async function mountQuestions(data: unknown[]) {
    const fetchMock = stubFetch({ '/api/agents/11/questions': { data } })
    const wrapper = mount(AgentQuestions, {
        props: { agentId: 11 },
        global: { plugins: [...installPinia()] },
    })
    await flushPromises()
    return { wrapper, fetchMock }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('AgentQuestions', () => {
    it('renders nothing when the agent has asked no questions', async () => {
        const { wrapper, fetchMock } = await mountQuestions([])

        expect(fetchMock).toHaveBeenCalledWith('/api/agents/11/questions')
        expect(wrapper.find('[data-testid="agent-questions"]').exists()).toBe(false)
    })

    it('shows each question as a message with its header and options', async () => {
        const { wrapper } = await mountQuestions([database, extras])

        const messages = wrapper.findAll('[data-testid="agent-question"]')
        expect(messages).toHaveLength(2)
        expect(messages[0].text()).toContain('DB')
        expect(messages[0].text()).toContain('Which database?')
        expect(messages[0].text()).toContain('Embedded file-based database')
        expect(messages[0].text()).toContain('Waiting for an answer')
        expect(messages[1].text()).toContain('Select any')
    })

    it('shows the answer as a reply and highlights every chosen option', async () => {
        const { wrapper } = await mountQuestions([database, extras])

        const answered = wrapper.findAll('[data-testid="agent-question"]')[1]
        expect(answered.attributes('data-status')).toBe('answered')
        expect(answered.find('[data-testid="agent-question-answer"]').text()).toBe('Redis, S3')
        const chosen = answered
            .findAll('[data-testid="agent-question-option"]')
            .map(option => option.attributes('data-chosen'))
        expect(chosen).toEqual(['true', 'false', 'true'])
    })
})
