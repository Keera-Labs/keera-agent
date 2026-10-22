// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { router } from '@inertiajs/vue3'
import type { AgentQuestion } from '@/queries/agentQuestionsQuery'
import AgentQuestionCard from './AgentQuestionCard.vue'
import { useToastStore } from '@/stores/toastStore'
import { installPinia } from './testing'

vi.mock('@inertiajs/vue3', () => ({ router: { visit: vi.fn() } }))

function question(overrides: Partial<AgentQuestion> = {}): AgentQuestion {
    return {
        id: 5, agent_id: 1, project_id: 1, tool_use_id: 't1', kind: 'question',
        question: 'Which database should we use?', header: 'Database', detail: null,
        options: [
            { label: 'Postgres', description: 'Battle tested', recommended: true },
            { label: 'SQLite', description: 'Zero setup', recommended: false },
        ],
        multi_select: false, status: 'pending', answer: null, answered_at: null,
        created_at: '2026-10-22T10:00:00Z',
        ...overrides,
    }
}

let posts: { url: string; body: unknown }[]
let response: { ok: boolean; status?: number; body: unknown }

function mountCard(q: AgentQuestion = question()) {
    return mount(AgentQuestionCard, { props: { question: q, agentName: 'Ada' }, global: { plugins: [...installPinia()] } })
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T10:12:00Z'))
    posts = []
    response = { ok: true, body: { data: { id: '5', attributes: {} } } }
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve({ ok: response.ok, status: response.status ?? (response.ok ? 200 : 500), json: () => Promise.resolve(response.body) })
    }))
    vi.mocked(router.visit).mockClear()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('AgentQuestionCard', () => {
    it('shows the question pill, paused agent and how long ago it was asked', () => {
        const wrapper = mountCard()

        expect(wrapper.get('[data-testid="question-kind-pill"]').text()).toBe('Question')
        expect(wrapper.text()).toContain('Ada is paused until you answer')
        expect(wrapper.get('[data-testid="agent-question-waiting"]').text()).toContain('Waiting for your answer… (asked 12m ago)')
    })

    it('preselects the agent pick', () => {
        const options = mountCard().findAll('[data-testid="question-option"]')

        expect(options[0].attributes('aria-checked')).toBe('true')
        expect(options[0].text()).toContain("Agent's pick")
        expect(options[1].attributes('aria-checked')).toBe('false')
    })

    it('opens the question in the Inbox', async () => {
        await mountCard().get('[data-testid="open-in-inbox"]').trigger('click')

        expect(router.visit).toHaveBeenCalledWith('/inbox?item=5')
    })

    it('sends the chosen option with an optional note', async () => {
        const wrapper = mountCard()
        await wrapper.findAll('[data-testid="question-option"]')[1].trigger('click')
        await wrapper.get('[data-testid="question-free-text"]').setValue('  keep it local  ')
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(posts).toEqual([{ url: '/api/agent-questions/5/answer', body: { choices: ['SQLite'], text: 'keep it local' } }])
    })

    it('answers free text when the question has no options', async () => {
        const wrapper = mountCard(question({ options: [] }))
        const sendButton = wrapper.get('[data-testid="send-answer"]')

        expect(wrapper.findAll('[data-testid="question-option"]')).toHaveLength(0)
        expect(sendButton.attributes('disabled')).toBeDefined()

        await wrapper.get('[data-testid="question-free-text"]').setValue('Use Postgres')
        expect(sendButton.attributes('disabled')).toBeUndefined()
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(posts[0].body).toEqual({ choices: [], text: 'Use Postgres' })
    })

    it('starts with nothing selected when no option is recommended', () => {
        const wrapper = mountCard(question({ options: [
            { label: 'A', description: null, recommended: false },
            { label: 'B', description: null, recommended: false },
        ] }))

        expect(wrapper.findAll('[aria-checked="true"]')).toHaveLength(0)
        expect(wrapper.find('[data-testid="agent-pick"]').exists()).toBe(false)
        expect(wrapper.get('[data-testid="send-answer"]').attributes('disabled')).toBeDefined()
    })

    it('shows what a permission approves and requires Allow or Deny', async () => {
        const wrapper = mountCard(question({
            kind: 'permission', question: 'Allow Bash?', header: 'Bash', detail: 'rm -rf build',
            options: [
                { label: 'Allow', description: null, recommended: false },
                { label: 'Deny', description: null, recommended: false },
            ],
        }))
        const sendButton = wrapper.get('[data-testid="send-answer"]')

        expect(wrapper.get('[data-testid="question-kind-pill"]').text()).toBe('Permission')
        expect(wrapper.get('[data-testid="question-detail"]').text()).toBe('rm -rf build')
        await wrapper.get('[data-testid="question-free-text"]').setValue('only the build dir')
        expect(sendButton.attributes('disabled')).toBeDefined()

        await wrapper.findAll('[data-testid="question-option"]')[1].trigger('click')
        expect(sendButton.attributes('disabled')).toBeUndefined()
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(posts[0].body).toEqual({ choices: ['Deny'], text: 'only the build dir' })
    })

    it('shows the error when the answer cannot be delivered', async () => {
        response = { ok: false, body: { error: "The agent's terminal is not running." } }
        const wrapper = mountCard()
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(wrapper.get('[role="alert"]').text()).toBe("The agent's terminal is not running.")
    })

    it('shows the first field error from a validation failure', async () => {
        response = { ok: false, status: 422, body: { errors: { choices: ['Pick an option or write an answer.'] } } }
        const wrapper = mountCard()
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(wrapper.get('[role="alert"]').text()).toBe('Pick an option or write an answer.')
    })

    it('toasts when the question was already answered in the terminal', async () => {
        const message = 'This question is no longer waiting for an answer.'
        response = { ok: false, status: 409, body: { error: message } }
        const wrapper = mountCard()
        await wrapper.get('form').trigger('submit')
        await flushPromises()

        expect(useToastStore().message).toBe(message)
        expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    })

    it('stacks the paused text, input and button for narrow widths', () => {
        const wrapper = mountCard()

        expect(wrapper.get('[data-testid="agent-question-paused"]').classes()).toEqual(
            expect.arrayContaining(['basis-full', '@md:basis-auto']),
        )
        const inputRow = wrapper.get('[data-testid="question-free-text"]').element.parentElement!
        expect([...inputRow.classList]).toEqual(expect.arrayContaining(['flex-col', '@md:flex-row']))
    })
})
