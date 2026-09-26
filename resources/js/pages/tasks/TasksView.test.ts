// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { Task } from '@/types/type'
import TasksView from './TasksView.vue'

let wrapper: VueWrapper | undefined

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 1,
        project_id: 1,
        title: 'Write docs',
        body: null,
        priority: 'medium',
        assignees: [],
        acceptance_criteria: [],
        testing_methods: [],
        validation_steps: [],
        status: 'pending',
        created_at: '2026-01-01',
        completed_at: null,
        ...overrides,
    }
}

function mountView(tasks: Task[]) {
    wrapper = mount(TasksView, {
        attachTo: document.body,
        props: { tasks, projects: [], workspaces: [], defaultProjectId: 1 },
    })
    return wrapper
}

const column = (w: VueWrapper, status: Task['status']) => w.get(`[data-status="${status}"]`)
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
})

describe('TasksView', () => {
    it('places each task in the column of its status', () => {
        const w = mountView([
            makeTask({ id: 1, title: 'A', status: 'pending' }),
            makeTask({ id: 2, title: 'B', status: 'in_progress' }),
            makeTask({ id: 3, title: 'C', status: 'in_progress' }),
        ])

        expect(column(w, 'pending').get('[data-testid="column-count"]').text()).toBe('1')
        expect(column(w, 'in_progress').get('[data-testid="column-count"]').text()).toBe('2')
        expect(column(w, 'in_progress').text()).toContain('B')
        expect(column(w, 'completed').text()).toContain('No tasks')
    })

    it('shows every column empty when there are no tasks', () => {
        const w = mountView([])
        const columns = w.findAll('[data-status]')
        expect(columns).toHaveLength(4)
        expect(columns.every(c => c.text().includes('No tasks'))).toBe(true)
    })

    it('moves a task to the column it is dropped on', async () => {
        const task = makeTask({ id: 7, status: 'pending' })
        const w = mountView([task])

        await w.get('[data-testid="task-card"]').trigger('dragstart')
        await column(w, 'completed').trigger('dragover')
        expect(column(w, 'completed').text()).toContain('Drop here')
        await column(w, 'completed').trigger('drop')

        expect(w.emitted('updateStatus')).toEqual([[task, 'completed']])
    })

    it('ignores a drop on the column the task already sits in', async () => {
        const w = mountView([makeTask({ status: 'pending' })])

        await w.get('[data-testid="task-card"]').trigger('dragstart')
        await column(w, 'pending').trigger('drop')

        expect(w.emitted('updateStatus')).toBeUndefined()
    })

    it('opens the task details when a card is clicked', async () => {
        const w = mountView([makeTask({
            title: 'Ship it',
            body: 'All the details',
            acceptance_criteria: ['It works'],
            testing_methods: ['vitest'],
        })])

        await w.get('[data-testid="task-card"]').trigger('click')

        expect(dialog()?.textContent).toContain('All the details')
        expect(dialog()?.textContent).toContain('It works')
        expect(dialog()?.textContent).toContain('vitest')
        expect(dialog()?.textContent).not.toContain('Validation Steps')
    })

    it('deletes a task without opening its details', async () => {
        const task = makeTask({ title: 'Obsolete' })
        const w = mountView([task])

        await w.get('button[aria-label="Delete Obsolete"]').trigger('click')

        expect(w.emitted('deleteTask')).toEqual([[task]])
        expect(dialog()).toBeNull()
    })

    it('opens the create-task modal from the header and the To Do column', async () => {
        const w = mountView([])

        await w.get('[aria-label="New task"]').trigger('click')
        expect(dialog()?.textContent).toContain('New Task')
        await w.vm.$nextTick()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await w.vm.$nextTick()
        expect(dialog()).toBeNull()

        await column(w, 'pending').get('[aria-label="New task"]').trigger('click')
        expect(dialog()?.textContent).toContain('New Task')
    })
})
