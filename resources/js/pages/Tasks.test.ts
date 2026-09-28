// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { computed, reactive, ref } from 'vue'
import type { ProjectAgent } from '@/queries/agentQuery'
import type { Task } from '@/types/type'
import Tasks from './Tasks.vue'
import TasksView from './tasks/TasksView.vue'

const pageProps = reactive<{ project: string; project_id: number | null; tasks?: Task[] }>({
    project: 'web',
    project_id: 4,
    tasks: [],
})
const reload = vi.fn()

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: pageProps }),
    router: { reload: (...args: unknown[]) => reload(...args) },
}))
const agents = ref<Partial<ProjectAgent>[]>([])
const invalidateAgents = vi.fn()
const invalidateQueries = vi.fn()
const disposeAgentSession = vi.fn()
const disposePmSession = vi.fn()

vi.mock('@/queries/agentQuery', () => ({
    useAgents: () => ({ agents: computed(() => agents.value), invalidate: invalidateAgents }),
}))
vi.mock('@pinia/colada', () => ({ useQueryCache: () => ({ invalidateQueries }) }))
vi.mock('@/stores/appLayoutStore', () => ({
    useAppLayoutStore: () => ({ disposeAgentSession, disposePmSession }),
}))
vi.mock('@/queries/projectsQuery', () => ({ default: () => ({ projects: computed(() => []) }) }))
vi.mock('@/queries/workspacesQuery', () => ({ default: () => ({ workspaces: computed(() => []) }) }))
// The layouts are only referenced for defineOptions; loading them would boot the whole app shell.
vi.mock('@/layouts/AppLayout.vue', () => ({ default: {} }))
vi.mock('@/layouts/ProjectLayout.vue', () => ({ default: {} }))

const task = { id: 9, title: 'Ship', status: 'pending' } as Task
const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))

function mountPage() {
    return shallowMount(Tasks).getComponent(TasksView)
}

beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    pageProps.tasks = [task]
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    agents.value = []
})

describe('Tasks page', () => {
    it('renders the tasks and project from the page props', () => {
        const view = mountPage()
        expect(view.props('tasks')).toEqual([task])
        expect(view.props('defaultProjectId')).toBe(4)
    })

    it('treats missing tasks as an empty board', () => {
        pageProps.tasks = undefined
        expect(mountPage().props('tasks')).toEqual([])
    })

    it('creates a task in the chosen project, then reloads the tasks', async () => {
        mountPage().vm.$emit('createTask', { title: 'New', body: '', assignees: ['Ana'], projectId: 7 })
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/7/tasks', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ title: 'New', body: '', assignees: ['Ana'] }),
        }))
        expect(reload).toHaveBeenCalledWith({ only: ['tasks'] })
    })

    it('updates a task status, then reloads the tasks', async () => {
        mountPage().vm.$emit('updateStatus', task, 'completed')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/tasks/9', expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ status: 'completed' }),
        }))
        expect(reload).toHaveBeenCalledWith({ only: ['tasks'] })
    })

    it('deletes a task, then reloads the tasks', async () => {
        mountPage().vm.$emit('deleteTask', task)
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/tasks/9', expect.objectContaining({ method: 'DELETE' }))
        expect(reload).toHaveBeenCalledWith({ only: ['tasks'] })
    })

    describe('pause all', () => {
        const confirm = vi.fn(() => true)

        beforeEach(() => {
            vi.stubGlobal('confirm', confirm)
            agents.value = [
                { id: 1, status: 'running', agent_type: 'software_engineer' },
                { id: 2, status: 'needs_input', agent_type: 'pm' },
                { id: 3, status: 'idle', agent_type: 'qa' },
            ]
        })

        it('offers pause all only while an agent runs', async () => {
            const view = mountPage()
            expect(view.props('canPauseAll')).toBe(true)

            agents.value = [{ id: 3, status: 'idle' }]
            await flushPromises()
            expect(view.props('canPauseAll')).toBe(false)
        })

        it('pauses after confirming, then toasts and refreshes agents and tasks', async () => {
            fetchMock.mockResolvedValueOnce(Response.json({ paused: [1, 2] }))
            const view = mountPage()

            view.vm.$emit('pauseAll')
            await flushPromises()

            expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Pause 2 running agents?'))
            expect(fetchMock).toHaveBeenCalledWith('/api/projects/4/agents/pause', { method: 'POST' })
            expect(disposeAgentSession).toHaveBeenCalledWith(1)
            expect(disposePmSession).toHaveBeenCalledWith(4)
            expect(view.props('notice')).toBe('Paused 2 agents')
            expect(invalidateAgents).toHaveBeenCalled()
            expect(invalidateQueries).toHaveBeenCalledWith({ key: ['agent-summaries'] })
            expect(reload).toHaveBeenCalledWith({ only: ['tasks'] })
        })

        it('does nothing when the confirm is declined', async () => {
            confirm.mockReturnValueOnce(false)
            const view = mountPage()

            view.vm.$emit('pauseAll')
            await flushPromises()

            expect(fetchMock).not.toHaveBeenCalled()
            expect(reload).not.toHaveBeenCalled()
        })

        it('reports a failed pause without refreshing', async () => {
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
            const view = mountPage()

            view.vm.$emit('pauseAll')
            await flushPromises()

            expect(view.props('notice')).toBe('Failed to pause agents')
            expect(disposeAgentSession).not.toHaveBeenCalled()
            expect(reload).not.toHaveBeenCalled()
        })
    })
})
