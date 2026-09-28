import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/type'
import { countByFilter, groupTasks, inFilter, matchesSearch, taskAge } from './taskList'

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 1, project_id: 1, title: 'Write docs', body: null, priority: 'medium', assignees: [],
        acceptance_criteria: [], testing_methods: [], validation_steps: [], status: 'pending',
        created_at: '2026-01-01T00:00:00Z', completed_at: null, ...overrides,
    }
}

describe('matchesSearch', () => {
    const task = makeTask({ id: 42, title: 'Fix checkout tax', body: 'Regional rules', assignees: ['Claude'] })

    it('matches every term case-insensitively across title, body, ref, project and assignees', () => {
        expect(matchesSearch(task, '')).toBe(true)
        expect(matchesSearch(task, 'CHECKOUT')).toBe(true)
        expect(matchesSearch(task, 'regional')).toBe(true)
        expect(matchesSearch(task, 'task-42')).toBe(true)
        expect(matchesSearch(task, 'claude', 'acme-web')).toBe(true)
        expect(matchesSearch(task, 'acme tax', 'acme-web')).toBe(true)
    })

    it('rejects a query when any term is missing', () => {
        expect(matchesSearch(task, 'checkout invoice')).toBe(false)
        expect(matchesSearch(task, 'acme')).toBe(false)
    })
})

describe('filters', () => {
    const tasks = [
        makeTask({ id: 1, status: 'pending' }),
        makeTask({ id: 2, status: 'in_progress' }),
        makeTask({ id: 3, status: 'in_progress' }),
        makeTask({ id: 4, status: 'completed' }),
        makeTask({ id: 5, status: 'cancelled' }),
    ]

    it('counts each tab, with cancelled tasks only under All', () => {
        expect(countByFilter(tasks)).toEqual({ all: 5, running: 2, done: 1, backlog: 1 })
    })

    it('keeps only the tab\'s statuses', () => {
        expect(tasks.filter(t => inFilter(t, 'running')).map(t => t.id)).toEqual([2, 3])
        expect(tasks.filter(t => inFilter(t, 'all'))).toHaveLength(5)
    })
})

describe('groupTasks', () => {
    it('orders sections by status, drops empty ones, and puts the newest activity first', () => {
        const sections = groupTasks([
            makeTask({ id: 1, status: 'completed', created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-05T00:00:00Z' }),
            makeTask({ id: 2, status: 'in_progress', created_at: '2026-01-02T00:00:00Z' }),
            makeTask({ id: 3, status: 'in_progress', created_at: '2026-01-03T00:00:00Z' }),
            makeTask({ id: 4, status: 'completed', created_at: '2026-01-04T00:00:00Z' }),
        ])

        expect(sections.map(s => [s.label, s.tasks.map(t => t.id)])).toEqual([
            ['Active agents', [3, 2]],
            ['Completed', [1, 4]],
        ])
    })

    it('returns no sections for no tasks', () => {
        expect(groupTasks([])).toEqual([])
    })
})

describe('taskAge', () => {
    const now = Date.parse('2026-01-01T03:00:00Z')

    it('describes the latest activity relative to now', () => {
        expect(taskAge(makeTask({ created_at: '2026-01-01T02:58:00Z' }), now)).toBe('2m ago')
        expect(taskAge(makeTask({ created_at: '2026-01-01T02:59:50Z' }), now)).toBe('now')
        expect(taskAge(makeTask({ created_at: '2025-12-31T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' }), now)).toBe('2h ago')
        expect(taskAge(makeTask({ created_at: 'not a date' }), now)).toBe('')
    })
})
