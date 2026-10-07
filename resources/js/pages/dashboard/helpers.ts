import { h, type FunctionalComponent } from 'vue'
import { color } from '@/tokens'
import { AGENT_TYPE_COLORS } from '@/types/agent'
import type { Project, Workspace } from '@/types/type'
import { agentColor } from '@/utils/agentColor'
import type { DashboardData, DashboardProject } from './types'

export function avatarColor(agentType: string, name: string): string {
    return AGENT_TYPE_COLORS[agentType] ?? agentColor(name)
}

// lucide "folder" glyph, inlined because the Vue app has no icon package.
export const FolderIcon: FunctionalComponent<{ size?: number; fill?: string }> = ({ size = 13, fill = color.textMuted }) =>
    h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: fill,
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        class: 'shrink-0',
        'aria-hidden': 'true',
    }, [
        h('path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }),
    ])
FolderIcon.props = ['size', 'fill']

export function projectStatusSummary(p: DashboardProject): string {
    const parts: string[] = []
    if (p.activeCount) parts.push(`${p.activeCount} active`)
    if (p.waitingCount) parts.push(`${p.waitingCount} waiting`)
    if (p.queuedCount) parts.push(`${p.queuedCount} queued`)
    if (p.doneCount) parts.push(`${p.doneCount} done`)
    return parts.join(' · ') || 'No agents'
}

// Scope the server snapshot (computed for ALL projects, with no per-project
// workspace_id) to the sidebar's selected workspace: keep only projects in
// that workspace and re-aggregate the totals from their counts.
// null selection = "All Projects", returned untouched.
export function scopeDashboard(
    dashboard: DashboardData,
    workspaceId: number | null,
    projects: Project[],
    workspaces: Workspace[],
): DashboardData {
    if (workspaceId === null) return dashboard

    const ids = new Set(projects.filter(p => Number(p.workspace_id) === workspaceId).map(p => p.id))
    const scopedProjects = dashboard.projects.filter(p => ids.has(p.id))
    const names = new Set(scopedProjects.map(p => p.name))
    const workingNow = dashboard.workingNow.filter(a => names.has(a.project))

    const stats = { projects: scopedProjects.length, active: 0, waiting: 0, queued: 0 }
    let agentCount = 0
    for (const p of scopedProjects) {
        stats.active += p.activeCount
        stats.waiting += p.waitingCount
        stats.queued += p.queuedCount
        agentCount += p.activeCount + p.waitingCount + p.queuedCount + p.doneCount
    }

    return {
        ...dashboard,
        workspaceName: workspaces.find(w => w.id === workspaceId)?.name ?? dashboard.workspaceName,
        agentCount,
        projectCount: scopedProjects.length,
        stats,
        workingNow,
        projects: scopedProjects,
    }
}
