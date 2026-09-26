import type { AgentSummary } from '@/queries/agentSummariesQuery'
import type { Project } from '@/types/type'

export interface ProjectGroup {
    id: 'in-progress' | 'projects'
    label: string
    projects: Project[]
}

/**
 * Split projects into "In progress" (a running agent or a running project
 * session) and the rest, keeping the incoming order within each group.
 */
export function groupProjects(
    projects: Project[],
    agentsByProject: Map<number, AgentSummary[]>,
    projectStatus: Record<number, string | undefined>,
): ProjectGroup[] {
    const isInProgress = (project: Project) =>
        projectStatus[project.id] === 'running'
        || (agentsByProject.get(project.id) ?? []).some(agent => agent.status === 'running')

    return [
        { id: 'in-progress', label: 'In progress', projects: projects.filter(isInProgress) },
        { id: 'projects', label: 'Projects', projects: projects.filter(p => !isInProgress(p)) },
    ]
}

/** Compact age like the reference sidebar: "now", "5m", "3h", "2d". */
export function relativeTime(iso: string | null, now: number): string {
    if (!iso) return ''
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return ''
    const minutes = Math.floor(Math.max(0, now - then) / 60_000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
}

const COLLAPSED_KEY = 'keera.sidebar.collapsedProjects'

export function loadCollapsedProjects(): Set<number> {
    try {
        const stored = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]')
        return new Set(Array.isArray(stored) ? stored.filter(Number.isInteger) : [])
    } catch {
        return new Set()
    }
}

export function saveCollapsedProjects(ids: Set<number>) {
    try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
    } catch { /* storage unavailable: collapse state stays in memory */ }
}
