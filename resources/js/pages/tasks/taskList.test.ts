import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    asUtc,
    countByFilter,
    groupTasks,
    inFilter,
    matchesSearch,
    startOfLocalDay,
    taskAge,
} from './taskList'
import { makeTask } from './testing'

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

    it('matches the branch and PR number, and still the task id', () => {
        const pr = makeTask({ id: 7, pr_number: 1842, branch: 'fix/eu-promo-checkout' })
        expect(matchesSearch(pr, 'eu-promo')).toBe(true)
        expect(matchesSearch(pr, '#1842')).toBe(true)
        expect(matchesSearch(pr, 'pr #1842')).toBe(true)
        expect(matchesSearch(pr, '1842')).toBe(true)
        expect(matchesSearch(pr, 'task-7')).toBe(true)
        expect(matchesSearch(pr, '#1841')).toBe(false)
    })
})

describe('filters', () => {
    const tasks = [
        makeTask({ id: 1, status: 'pending' }),
        makeTask({ id: 2, status: 'in_progress' }),
        makeTask({ id: 3, status: 'in_progress' }),
        makeTask({ id: 4, status: 'completed' }),
        makeTask({ id: 5, status: 'cancelled' }),
        makeTask({ id: 6, status: 'in_review' }),
    ]

    it('counts each tab, with cancelled tasks only under All', () => {
        expect(countByFilter(tasks)).toEqual({ all: 6, running: 2, review: 1, done: 1, backlog: 1 })
    })

    it('keeps only the tab\'s statuses', () => {
        expect(tasks.filter(t => inFilter(t, 'running')).map(t => t.id)).toEqual([2, 3])
        expect(tasks.filter(t => inFilter(t, 'review')).map(t => t.id)).toEqual([6])
        expect(tasks.filter(t => inFilter(t, 'all'))).toHaveLength(6)
    })
})

describe('groupTasks', () => {
    it('orders sections by status, drops empty ones, and puts the newest activity first', () => {
        const sections = groupTasks([
            makeTask({ id: 1, status: 'completed', created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-05T00:00:00Z' }),
            makeTask({ id: 2, status: 'in_progress', created_at: '2026-01-02T00:00:00Z' }),
            makeTask({ id: 3, status: 'in_progress', created_at: '2026-01-03T00:00:00Z' }),
            makeTask({ id: 4, status: 'completed', created_at: '2026-01-04T00:00:00Z' }),
            makeTask({ id: 5, status: 'in_review' }),
            makeTask({ id: 6, status: 'pending' }),
        ])

        expect(sections.map(s => [s.label, s.tasks.map(t => t.id)])).toEqual([
            ['Active agents', [3, 2]],
            ['Awaiting review', [5]],
            ['Completed', [1, 4]],
            ['Backlog', [6]],
        ])
    })

    it('returns no sections for no tasks', () => {
        expect(groupTasks([])).toEqual([])
    })

    describe('completed today', () => {
        afterEach(() => vi.unstubAllEnvs())

        it('keeps only completions since the local midnight, read from naive UTC timestamps', () => {
            vi.stubEnv('TZ', 'America/Los_Angeles')
            // 03:00 UTC on Jan 1 is 19:00 on Dec 31 in Los Angeles, whose day began at 08:00 UTC.
            const since = startOfLocalDay(Date.parse('2026-01-01T03:00:00Z'))
            expect(since).toBe(Date.parse('2025-12-31T08:00:00Z'))

            const sections = groupTasks([
                makeTask({ id: 1, status: 'completed', completed_at: '2025-12-31 09:00:00' }),
                makeTask({ id: 2, status: 'completed', completed_at: '2025-12-31T07:59:00' }),
                makeTask({ id: 3, status: 'completed', completed_at: null }),
                makeTask({ id: 4, status: 'pending' }),
            ], since)

            expect(sections.map(s => [s.label, s.tasks.map(t => t.id)])).toEqual([
                ['Completed today', [1]],
                ['Backlog', [4]],
            ])
        })

        it('drops the section when nothing completed today', () => {
            const sections = groupTasks([makeTask({ status: 'completed', completed_at: '2020-01-01T00:00:00Z' })], Date.now())
            expect(sections).toEqual([])
        })
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

    it('reads naive backend timestamps as UTC, not local time', () => {
        vi.stubEnv('TZ', 'America/Los_Angeles')
        expect(taskAge(makeTask({ created_at: '2026-01-01 02:58:00' }), now)).toBe('2m ago')
        expect(taskAge(makeTask({ created_at: '2026-01-01T02:58:00' }), now)).toBe('2m ago')
        expect(taskAge(makeTask({ created_at: '2026-01-01T04:58:00+02:00' }), now)).toBe('2m ago')
    })

    afterEach(() => vi.unstubAllEnvs())
})

describe('asUtc', () => {
    it('adds a UTC designator only when the timestamp has no offset', () => {
        expect(asUtc('2026-01-01 02:58:00')).toBe('2026-01-01T02:58:00Z')
        expect(asUtc('2026-01-01T02:58:00.123456')).toBe('2026-01-01T02:58:00.123456Z')
        expect(asUtc('2026-01-01T02:58:00Z')).toBe('2026-01-01T02:58:00Z')
        expect(asUtc('2026-01-01T02:58:00-07:00')).toBe('2026-01-01T02:58:00-07:00')
        expect(asUtc(null)).toBeNull()
    })
})
