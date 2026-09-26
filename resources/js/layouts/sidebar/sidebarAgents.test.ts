// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentSummary } from '@/queries/agentSummariesQuery'
import type { Project } from '@/types/type'
import { groupProjects, loadCollapsedProjects, relativeTime, saveCollapsedProjects } from './sidebarAgents'

const project = (id: number): Project => ({
    id, name: `p-${id}`, slug: `p-${id}`, path: `/tmp/p-${id}`, language: 'ts',
    workspace_id: null, claude_status: null, system_prompt: null,
})

const agent = (id: number, projectId: number, status: AgentSummary['status']): AgentSummary => ({
    id, project_id: projectId, name: `a-${id}`, provider: 'claude', agent_type: 'software_engineer',
    status, last_message: null, last_activity_at: null,
})

describe('groupProjects', () => {
    it('puts projects with a running agent or session under "In progress", keeping order', () => {
        const agents = new Map([
            [1, [agent(1, 1, 'idle')]],
            [2, [agent(2, 2, 'waiting'), agent(3, 2, 'running')]],
        ])

        const [inProgress, rest] = groupProjects([project(1), project(2), project(3), project(4)], agents, { 4: 'running' })

        expect(inProgress.label).toBe('In progress')
        expect(inProgress.projects.map(p => p.id)).toEqual([2, 4])
        expect(rest.projects.map(p => p.id)).toEqual([1, 3])
    })

    it('treats a finished session as not in progress', () => {
        const [inProgress, rest] = groupProjects([project(1)], new Map(), { 1: 'done' })

        expect(inProgress.projects).toEqual([])
        expect(rest.projects.map(p => p.id)).toEqual([1])
    })
})

describe('relativeTime', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')

    it.each([
        ['2026-09-26T11:59:30Z', 'now'],
        ['2026-09-26T11:55:00Z', '5m'],
        ['2026-09-26T09:00:00Z', '3h'],
        ['2026-09-24T12:00:00Z', '2d'],
        ['2026-09-26T12:05:00Z', 'now'],
    ])('formats %s as %s', (iso, expected) => {
        expect(relativeTime(iso, now)).toBe(expected)
    })

    it('is empty without a valid timestamp', () => {
        expect(relativeTime(null, now)).toBe('')
        expect(relativeTime('not a date', now)).toBe('')
    })
})

describe('collapsed projects persistence', () => {
    beforeEach(() => localStorage.clear())

    it('round-trips through localStorage', () => {
        saveCollapsedProjects(new Set([3, 7]))
        expect([...loadCollapsedProjects()]).toEqual([3, 7])
    })

    it('ignores corrupt stored values', () => {
        localStorage.setItem('keera.sidebar.collapsedProjects', '{nope')
        expect(loadCollapsedProjects().size).toBe(0)
    })
})
