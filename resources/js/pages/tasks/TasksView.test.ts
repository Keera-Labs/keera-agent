// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { Project, Task } from '@/types/type'
import TasksView from './TasksView.vue'
import { makeTask } from './testing'

let wrapper: VueWrapper | undefined

const projects = [{ id: 1, name: 'acme-web' }, { id: 2, name: 'salut-ai' }] as Project[]

function mountView(tasks: Task[], extra: { canPauseAll?: boolean; notice?: string | null } = {}) {
    wrapper = mount(TasksView, {
        attachTo: document.body,
        props: { tasks, projects, workspaces: [], defaultProjectId: 1, ...extra },
    })
    return wrapper
}

const completedNow = () => new Date().toISOString()

const sectionTitles = (w: VueWrapper) => w.findAll('[data-testid="task-title"]').map(t => t.text())
const metaParts = (w: VueWrapper) => w.get('[data-testid="task-meta"]').findAll(':scope > *').map(part => part.text())
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
        makeTask({ id: 3, title: 'Ship', status: 'completed', completed_at: completedNow() }),
    ]

    it('shows the total, running count and tab counts in the header', () => {
        const w = mountView(tasks)

        expect(w.get('[data-testid="task-total"]').text()).toBe('3')
        expect(w.get('[data-testid="running-pill"]').text()).toBe('1 running')
        expect(tab(w, 'all').text()).toBe('All 3')
        expect(tab(w, 'running').text()).toBe('Running 1')
        expect(tab(w, 'done').text()).toBe('Done 1')
        expect(tab(w, 'backlog').text()).toBe('Backlog 1')
        expect(tab(w, 'review').text()).toBe('In review 0')
    })

    it('hides the running pill when nothing runs', () => {
        expect(mountView([makeTask()]).find('[data-testid="running-pill"]').exists()).toBe(false)
    })

    it('groups tasks into status sections with counts', () => {
        const w = mountView(tasks)

        const sections = w.findAll('[data-section]')
        expect(sections.map(s => s.attributes('data-section'))).toEqual(['in_progress', 'completed', 'pending'])
        expect(sections[0].text()).toContain('Active agents')
        expect(sections[0].get('[data-testid="section-count"]').text()).toBe('1')
        expect(sections[0].get('[data-testid="task-ref"]').text()).toBe('TASK-2')
        expect(sections[0].get('[data-testid="task-meta"]').text()).toContain('salut-ai')
        expect(sections[0].get('[data-testid="project-avatar"]').text()).toBe('S')
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
        expect(tab(w, 'all').text()).toBe('All 1')
        expect(tab(w, 'done').text()).toBe('Done 0')

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

        await w.get('[data-testid="task-row"]').trigger('click')

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

    it('searches branches and PR numbers', async () => {
        const w = mountView([
            makeTask({ id: 1, title: 'Promo tax', status: 'in_progress', branch: 'fix/eu-promo-checkout' }),
            makeTask({ id: 2, title: 'Null guard', status: 'in_review', pr_number: 1841 }),
        ])
        const search = w.get('input[type="search"]')

        expect(search.attributes('placeholder')).toBe('Search tasks, branches or PRs...')
        await search.setValue('eu-promo')
        expect(sectionTitles(w)).toEqual(['Promo tax'])
        await search.setValue('#1841')
        expect(sectionTitles(w)).toEqual(['Null guard'])
    })

    describe('review status', () => {
        const review = makeTask({
            id: 5,
            title: 'Add null guard',
            status: 'in_review',
            pr_number: 1841,
            pr_url: 'https://github.com/acme/web/pull/1841',
            additions: 12,
            deletions: 4,
            review_note: 'Coderabbit review ready',
        })

        it('has an In review tab and an Awaiting review section with the review icon', async () => {
            const w = mountView([...tasks, review])

            expect(tab(w, 'review').text()).toBe('In review 1')
            const section = w.get('[data-section="in_review"]')
            expect(section.text()).toContain('Awaiting review')
            expect(section.get('[data-testid="section-count"]').text()).toBe('1')
            expect(section.get('[data-testid="task-status-icon"]').attributes('aria-label')).toBe('In Review')

            await tab(w, 'review').trigger('click')
            expect(sectionTitles(w)).toEqual(['Add null guard'])
        })

        it('offers In Review in the card status dropdown', async () => {
            const task = makeTask({ title: 'Plan' })
            const w = mountView([task])
            const select = w.get('select[aria-label="Status of Plan"]')

            expect(select.findAll('option').map(o => o.text())).toContain('In Review')
            await select.setValue('in_review')
            expect(w.emitted('updateStatus')).toEqual([[task, 'in_review']])
        })

        it('shows In Review in the task modal', async () => {
            const w = mountView([review])
            await w.get('[data-testid="task-row"]').trigger('click')
            expect(dialog()?.textContent).toContain('In Review')
        })

        it('links the PR from the meta line without opening the task', async () => {
            const w = mountView([review])

            const link = w.get('a[data-testid="task-pr"]')
            expect(link.text()).toBe('PR #1841')
            expect(link.attributes('href')).toBe('https://github.com/acme/web/pull/1841')
            expect(link.attributes('target')).toBe('_blank')
            expect(w.get('[data-testid="task-ref"]').text()).toBe('TASK-5')

            await link.trigger('click')
            expect(dialog()).toBeNull()
        })
    })

    describe('row meta', () => {
        it('shows the project avatar, task id and agents, with high priority as a badge', () => {
            const w = mountView([makeTask({
                id: 12,
                project_id: 2,
                priority: 'high',
                assignees: ['Frontend Engineer'],
                branch: 'fix/eu-promo',
                acceptance_criteria: ['It works'],
            })])

            expect(metaParts(w)).toEqual(['S', 'salut-ai', '·', 'TASK-12', '·', 'Frontend Engineer'])
            expect(w.get('[data-testid="task-row"]').text()).toContain('high')
            expect(w.find('[data-testid="task-pr"]').exists()).toBe(false)
            expect(w.get('[data-testid="task-row"]').text()).not.toContain('fix/eu-promo')
            expect(w.get('[data-testid="task-row"]').text()).not.toContain('criteria')
        })

        it('leaves out a missing project and agent without stray separators', () => {
            const w = mountView([makeTask({ id: 3, project_id: 99 })])

            expect(metaParts(w)).toEqual(['TASK-3'])
            expect(w.find('[data-testid="project-avatar"]').exists()).toBe(false)
        })
    })

    describe('completed today', () => {
        const old = makeTask({ id: 8, title: 'Old ship', status: 'completed', completed_at: '2020-01-01T00:00:00' })
        const today = makeTask({ id: 9, title: 'New ship', status: 'completed', completed_at: completedNow() })

        it('lists only today\'s completions under All, and every one under Done', async () => {
            const w = mountView([old, today])

            expect(w.get('[data-section="completed"] h2').text()).toContain('Completed today')
            expect(sectionTitles(w)).toEqual(['New ship'])
            expect(tab(w, 'done').text()).toBe('Done 2')

            await tab(w, 'done').trigger('click')
            expect(w.get('[data-section="completed"] h2').text()).not.toContain('Completed today')
            expect(sectionTitles(w)).toEqual(['New ship', 'Old ship'])
        })

        it('points to the Done tab when only older completions exist', () => {
            const w = mountView([old])
            expect(w.get('[data-testid="tasks-empty"]').text()).toBe('Nothing completed today. Earlier tasks are under Done.')
        })
    })

    describe('pause all', () => {
        it('shows the link on the Active agents header when agents run', async () => {
            const w = mountView(tasks, { canPauseAll: true })

            const link = w.get('[data-section="in_progress"] [data-testid="pause-all"]')
            expect(link.text()).toBe('Pause all')
            await link.trigger('click')
            expect(w.emitted('pauseAll')).toHaveLength(1)
        })

        it('is hidden when nothing runs', () => {
            expect(mountView(tasks).find('[data-testid="pause-all"]').exists()).toBe(false)
        })

        it('shows the notice as a toast', () => {
            const w = mountView(tasks, { notice: 'Paused 2 agents' })
            expect(w.get('[role="status"]').text()).toBe('Paused 2 agents')
        })
    })
})
