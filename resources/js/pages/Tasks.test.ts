// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { computed, reactive } from 'vue'
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
    fetchMock.mockClear()
    reload.mockClear()
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
})
