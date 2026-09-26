// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick } from 'vue'
import Dashboard from '@/pages/Dashboard.vue'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Project, Workspace } from '@/types/type'
import { projectStatusSummary } from './helpers'
import type { DashboardData, DashboardProject } from './types'

const inertia = vi.hoisted(() => ({
    props: {} as { dashboard: DashboardData },
    visit: vi.fn(),
}))

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => ({ props: inertia.props }),
    router: { visit: inertia.visit },
}))

const lists = vi.hoisted(() => ({ projects: [] as Project[], workspaces: [] as Workspace[] }))

vi.mock('@/queries/projectsQuery', () => ({
    default: () => ({ projects: computed(() => lists.projects) }),
}))

vi.mock('@/queries/workspacesQuery', () => ({
    default: () => ({ workspaces: computed(() => lists.workspaces) }),
}))

function project(id: number, name: string, counts: Partial<DashboardProject> = {}): DashboardProject {
    return {
        id, name, slug: name.toLowerCase(), online: true,
        agents: [{ initials: 'AB', agentType: 'claude' }], extraAgents: 0,
        activeCount: 0, waitingCount: 0, queuedCount: 0, doneCount: 0,
        lastActivity: '2m ago',
        ...counts,
    }
}

function dashboard(): DashboardData {
    return {
        workspaceName: 'All Projects',
        agentCount: 6,
        projectCount: 2,
        stats: { projects: 2, active: 2, waiting: 1, queued: 3 },
        workingNow: [
            { id: 1, name: 'Alpha Bot', initials: 'AB', agentType: 'claude', role: 'Engineer', description: 'Fixing bugs', project: 'Alpha', elapsed: '5m' },
            { id: 2, name: 'Beta Bot', initials: 'BB', agentType: 'claude', role: 'QA', description: 'Testing', project: 'Beta', elapsed: '1m' },
        ],
        projects: [
            project(10, 'Alpha', { activeCount: 1, waitingCount: 1, extraAgents: 2 }),
            project(20, 'Beta', { activeCount: 1, queuedCount: 3 }),
        ],
    }
}

const text = (w: ReturnType<typeof mount>) => w.text().replace(/\s+/g, ' ')

describe('Dashboard page', () => {
    beforeEach(() => {
        localStorage.clear()
        setActivePinia(createPinia())
        inertia.props = { dashboard: dashboard() }
        inertia.visit.mockReset()
        lists.projects = [
            { id: 10, name: 'Alpha', slug: 'alpha', workspace_id: 1 } as Project,
            { id: 20, name: 'Beta', slug: 'beta', workspace_id: 2 } as Project,
        ]
        lists.workspaces = [{ id: 1, name: 'Frontend' } as Workspace, { id: 2, name: 'Backend' } as Workspace]
    })

    it('shows the empty state when there are no projects', () => {
        inertia.props = { dashboard: { ...dashboard(), projectCount: 0, projects: [], workingNow: [] } }
        const w = mount(Dashboard)
        expect(w.text()).toBe('No projects yet. Create one to get started.')
    })

    it('renders the full snapshot for "All Projects"', () => {
        const w = mount(Dashboard)
        const t = text(w)
        expect(t).toContain('All Projects')
        expect(t).toContain('6 agents working across 2 projects.')
        expect(t).toContain('Working now2')
        expect(t).toContain('Alpha Bot')
        expect(t).toContain('Beta Bot')
        expect(w.findAll('button[title^="Open "]')).toHaveLength(2)
        expect(t).toContain('+2')
    })

    it('scopes projects, agents and totals to the selected workspace, live', async () => {
        const w = mount(Dashboard)
        useWorkspaceStore().setCurrentWorkspaceId(2)
        await nextTick()

        const t = text(w)
        expect(t).toContain('Backend')
        expect(t).toContain('4 agents working across 1 projects.')
        expect(t).toContain('Working now1')
        expect(t).not.toContain('Alpha Bot')
        expect(w.findAll('button[title^="Open "]').map(b => b.attributes('title'))).toEqual(['Open Beta'])
    })

    it('shows the empty state when the selected workspace has no projects', async () => {
        const w = mount(Dashboard)
        useWorkspaceStore().setCurrentWorkspaceId(99)
        await nextTick()
        expect(w.text()).toBe('No projects yet. Create one to get started.')
    })

    it('hides "Working now" when no agent is working', () => {
        inertia.props = { dashboard: { ...dashboard(), workingNow: [] } }
        expect(mount(Dashboard).text()).not.toContain('Working now')
    })

    it('opens the project when its card is clicked', async () => {
        const w = mount(Dashboard)
        await w.get('button[title="Open Beta"]').trigger('click')
        expect(inertia.visit).toHaveBeenCalledWith('/beta')
    })
})

describe('projectStatusSummary', () => {
    it('lists non-zero counts in order', () => {
        expect(projectStatusSummary(project(1, 'X', { activeCount: 2, doneCount: 1 }))).toBe('2 active · 1 done')
    })

    it('falls back when the project has no agents', () => {
        expect(projectStatusSummary(project(1, 'X'))).toBe('No agents')
    })
})
