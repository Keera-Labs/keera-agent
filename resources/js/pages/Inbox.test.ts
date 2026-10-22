// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { router } from '@inertiajs/vue3'
import { installPinia } from '@/pages/agents/testing'
import Inbox from './Inbox.vue'

const page = reactive<{ props: Record<string, unknown> }>({ props: {} })

vi.mock('@inertiajs/vue3', () => ({ usePage: () => page, router: { visit: vi.fn() } }))

function resource(id: number, attributes: Record<string, unknown> = {}) {
    return {
        id: String(id),
        attributes: {
            agent_id: id * 10, project_id: 1, tool_use_id: `t${id}`, kind: 'question',
            question: `Question ${id}?`, header: null,
            options: [
                { label: 'Yes', description: 'Ship it', recommended: true },
                { label: 'No', description: null, recommended: false },
            ],
            multi_select: false, status: 'pending', answer: null, answered_at: null,
            created_at: '2026-10-22 10:00:00',
            agent_name: `Agent ${id}`, agent_type: 'software_engineer', task_id: 40 + id,
            worktree: `agent-${id * 10}`, project_name: 'Keera', project_slug: 'keera',
            ...attributes,
        },
    }
}

enableAutoUnmount(afterEach)

let pending: ReturnType<typeof resource>[]
let answered: ReturnType<typeof resource>[]
let posts: { url: string; body: unknown }[]

function mountInbox() {
    return mount(Inbox, { global: { plugins: [...installPinia()] } })
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T10:12:00Z'))
    page.props = {}
    pending = [
        resource(1),
        resource(2, { kind: 'permission', question: 'Allow Bash: rm -rf build?', project_name: 'Docs', project_id: 2 }),
    ]
    answered = [resource(3, { status: 'answered', answer: 'Yes', answered_at: '2026-10-22 10:10:00' })]
    posts = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            posts.push({ url, body: JSON.parse(String(init.body)) })
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: resource(1) }) })
        }
        const { pathname, searchParams } = new URL(url, 'http://test')
        if (pathname !== '/api/agent-questions') return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        const status = searchParams.get('status')
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: status === 'answered' ? answered : pending }) })
    }))
    vi.mocked(router.visit).mockClear()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('Inbox page', () => {
    it('shows the pending count, tabs and a list of questions and permissions across projects', async () => {
        const wrapper = mountInbox()
        await flushPromises()

        expect(wrapper.get('[data-testid="inbox-pending-pill"]').text()).toBe('2 pending')
        expect(wrapper.get('[data-testid="inbox-tab-pending"]').text()).toContain('2')
        expect(wrapper.get('[data-testid="inbox-tab-answered"]').text()).toContain('1')
        const items = wrapper.findAll('[data-testid="inbox-item"]')
        expect(items.map(item => item.get('[data-testid="question-kind-pill"]').text())).toEqual(['Question', 'Permission'])
        expect(items[0].text()).toContain('Keera')
        expect(items[0].text()).toContain('TASK-41')
        expect(items[1].text()).toContain('Docs')
    })

    it('details the first item with the paused time and the agent pick preselected', async () => {
        const wrapper = mountInbox()
        await flushPromises()

        const detail = wrapper.get('[data-testid="inbox-detail"]')
        expect(detail.text()).toContain('Question 1?')
        expect(detail.text()).toContain('agent-10')
        expect(detail.get('[data-testid="inbox-paused"]').text()).toBe('Paused · waiting 12m')
        expect(detail.get('[data-testid="agent-pick"]').text()).toMatch(/agent's pick/i)
        expect(detail.findAll('[data-testid="question-option"]')[0].attributes('aria-checked')).toBe('true')
    })

    it('selects an item from the list', async () => {
        const wrapper = mountInbox()
        await flushPromises()
        await wrapper.findAll('[data-testid="inbox-item"]')[1].trigger('click')

        expect(wrapper.get('[data-testid="inbox-detail"] h2').text()).toBe('Allow Bash: rm -rf build?')
        expect(wrapper.findAll('[data-testid="inbox-item"]')[1].attributes('aria-current')).toBe('true')
    })

    it('opens the item requested in the URL', async () => {
        page.props = { selected_question_id: 2 }
        const wrapper = mountInbox()
        await flushPromises()

        expect(wrapper.get('[data-testid="inbox-detail"] h2').text()).toBe('Allow Bash: rm -rf build?')
    })

    it('sends the answer with the button and with cmd+enter', async () => {
        const wrapper = mountInbox()
        await flushPromises()
        await wrapper.get('[data-testid="question-free-text"]').setValue('after the tests pass')
        await wrapper.get('[data-testid="send-answer"]').trigger('click')
        await flushPromises()

        expect(posts).toEqual([{ url: '/api/agent-questions/1/answer', body: { choices: ['Yes'], text: 'after the tests pass' } }])

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))
        await flushPromises()
        expect(posts).toHaveLength(2)
    })

    it('moves an item to the back of the queue with Later', async () => {
        const wrapper = mountInbox()
        await flushPromises()
        await wrapper.get('[data-testid="answer-later"]').trigger('click')

        expect(wrapper.get('[data-testid="inbox-detail"] h2').text()).toBe('Allow Bash: rm -rf build?')
        expect(wrapper.findAll('[data-testid="inbox-item"]')[0].text()).toContain('Allow Bash')
    })

    it('opens the agent chat', async () => {
        const wrapper = mountInbox()
        await flushPromises()
        await wrapper.get('[data-testid="open-chat"]').trigger('click')

        expect(router.visit).toHaveBeenCalledWith('/keera/agents/10')
    })

    it('shows answered items with their answer', async () => {
        const wrapper = mountInbox()
        await flushPromises()
        await wrapper.get('[data-testid="inbox-tab-answered"]').trigger('click')

        expect(wrapper.findAll('[data-testid="inbox-item"]')).toHaveLength(1)
        expect(wrapper.get('[data-testid="inbox-answer"]').text()).toContain('Yes')
        expect(wrapper.find('[data-testid="send-answer"]').exists()).toBe(false)
    })

    it('shows empty states', async () => {
        pending = []
        answered = []
        const wrapper = mountInbox()
        await flushPromises()

        expect(wrapper.get('[data-testid="inbox-pending-pill"]').text()).toBe('0 pending')
        expect(wrapper.get('[data-testid="inbox-empty"]').text()).toContain('Nothing waiting on you')
        await wrapper.get('[data-testid="inbox-tab-answered"]').trigger('click')
        expect(wrapper.get('[data-testid="inbox-empty"]').text()).toContain('No answered questions yet')
    })
})
