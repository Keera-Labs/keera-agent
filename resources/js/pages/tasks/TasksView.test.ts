// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { Project, Task } from '@/types/type'
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

const projects = [{ id: 1, name: 'acme-web' }, { id: 2, name: 'salut-ai' }] as Project[]

function mountView(tasks: Task[]) {
    wrapper = mount(TasksView, {
        attachTo: document.body,
        props: { tasks, projects, workspaces: [], defaultProjectId: 1 },
    })
    return wrapper
}

const sectionTitles = (w: VueWrapper) => w.findAll('[data-testid="task-title"]').map(t => t.text())
const tab = (w: VueWrapper, id: string) => w.get(`[data-filter="${id}"]`)
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
})

describe('TasksView', () => {
    const tasks = [
        makeTask({ id: 1, title: 'Plan', status: 'pending' }),
        makeTask({ id: 2, title: 'Build checkout', status: 'in_progress', project_id: 2 }),
        makeTask({ id: 3, title: 'Ship', status: 'completed' }),
    ]

    it('shows the total, running count and tab counts in the header', () => {
        const w = mountView(tasks)

        expect(w.get('[data-testid="task-total"]').text()).toBe('3')
        expect(w.get('[data-testid="running-pill"]').text()).toBe('1 running')
        expect(tab(w, 'all').text()).toBe('All (3)')
        expect(tab(w, 'running').text()).toBe('Running (1)')
        expect(tab(w, 'done').text()).toBe('Done (1)')
        expect(tab(w, 'backlog').text()).toBe('Backlog (1)')
        expect(w.find('[data-filter="review"]').exists()).toBe(false)
    })

    it('hides the running pill when nothing runs', () => {
        expect(mountView([makeTask()]).find('[data-testid="running-pill"]').exists()).toBe(false)
    })

    it('groups tasks into status sections with counts', () => {
        const w = mountView(tasks)

        const sections = w.findAll('[data-section]')
        expect(sections.map(s => s.attributes('data-section'))).toEqual(['in_progress', 'pending', 'completed'])
        expect(sections[0].text()).toContain('Active agents')
        expect(sections[0].get('[data-testid="section-count"]').text()).toBe('· 1')
        expect(sections[0].text()).toContain('TASK-2')
        expect(sections[0].text()).toContain('· salut-ai')
        expect(sections[0].get('[data-testid="task-status-icon"]').attributes('aria-label')).toBe('Running')
    })

    it('strikes through the title of a closed task', () => {
        const w = mountView(tasks)
        const done = w.get('[data-section="completed"] [data-testid="task-title"]')
        expect(done.classes()).toContain('line-through')
    })

    it('filters by tab', async () => {
        const w = mountView(tasks)

        await tab(w, 'running').trigger('click')

        expect(tab(w, 'running').attributes('aria-selected')).toBe('true')
        expect(sectionTitles(w)).toEqual(['Build checkout'])
    })

    it('filters by search, updating tab counts, and shows an empty state', async () => {
        const w = mountView(tasks)
        const search = w.get('input[type="search"]')

        await search.setValue('salut')
        expect(sectionTitles(w)).toEqual(['Build checkout'])
        expect(tab(w, 'all').text()).toBe('All (1)')
        expect(tab(w, 'done').text()).toBe('Done (0)')

        await search.setValue('nothing like this')
        expect(w.get('[data-testid="tasks-empty"]').text()).toBe('No tasks match')
    })

    it('focuses the search on ⌘K', async () => {
        const w = mountView(tasks)

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))

        expect(document.activeElement).toBe(w.get('input[type="search"]').element)
    })

    it('shows the empty state without tasks', () => {
        expect(mountView([]).get('[data-testid="tasks-empty"]').text()).toBe('No tasks yet')
    })

    it('changes a task status from its card without opening its details', async () => {
        const task = makeTask({ id: 7, title: 'Plan' })
        const w = mountView([task])

        await w.get('select[aria-label="Status of Plan"]').setValue('completed')

        expect(w.emitted('updateStatus')).toEqual([[task, 'completed']])
        expect(dialog()).toBeNull()
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

    it('opens the create-task modal from New Task', async () => {
        const w = mountView([])

        await w.get('[aria-label="New task"]').trigger('click')

        expect(dialog()?.textContent).toContain('New Task')
    })
})
