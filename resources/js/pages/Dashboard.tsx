import { useMemo } from 'react'
import { usePage } from '@inertiajs/react'
import AppLayout from '@/layouts/AppLayout'
import useProjects from '@/queries/useProjects'
import useWorkspaces from '@/queries/useWorkspaces'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { CenteredMessage, DashboardBody } from '@/pages/dashboard/index'
import type { DashboardData } from '@/pages/dashboard/index'

export type * from '@/pages/dashboard/types'

// Workspace overview served at "/" via Inertia props.
export default function Dashboard() {
    const { dashboard } = usePage<{ dashboard: DashboardData }>().props
    const currentWorkspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
    const { workspaces } = useWorkspaces()
    const { projects } = useProjects()

    // Scope the server snapshot (computed for ALL projects, with no per-project
    // workspace_id) to the sidebar's selected workspace: keep only projects in
    // that workspace and re-aggregate the totals from their counts. Reading the
    // selection from the shared layout context is what keeps this live when the
    // picker changes in the same tab. null selection = "All Projects", untouched.
    const data = useMemo<DashboardData>(() => {
        if (currentWorkspaceId === null) return dashboard

        const ids = new Set(
            projects.filter(p => Number(p.workspace_id) === currentWorkspaceId).map(p => p.id),
        )
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
            workspaceName: workspaces.find(w => w.id === currentWorkspaceId)?.name ?? dashboard.workspaceName,
            agentCount,
            projectCount: scopedProjects.length,
            stats,
            workingNow,
            projects: scopedProjects,
        }
    }, [dashboard, currentWorkspaceId, projects, workspaces])

    if (data.projectCount === 0) {
        return <CenteredMessage text="No projects yet. Create one to get started." />
    }

    return <DashboardBody data={data} />
}

Dashboard.layout = [AppLayout]
