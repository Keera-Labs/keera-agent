// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadCollapsedProjects, saveCollapsedProjects } from './sidebarAgents'

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
