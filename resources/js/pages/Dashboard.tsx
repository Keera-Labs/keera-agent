import { useMemo } from 'react'
import { usePage } from '@inertiajs/react'
import AppLayout from '@/layouts/AppLayout'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import useProjects from '@/queries/useProjects'
import { CenteredMessage, DashboardBody, filterDashboardByWorkspace } from '@/pages/dashboard/index'
import type { DashboardData } from '@/pages/dashboard/index'

export type * from '@/pages/dashboard/types'

// Workspace overview served at "/" via Inertia props.
export default function Dashboard() {
    const { dashboard } = usePage<{ dashboard: DashboardData }>().props
    const { selectedWorkspaceId, workspaces } = useAppLayout()
    const { projects } = useProjects()

    // Scope the server snapshot to the sidebar's selected workspace. Reading the
    // selection from the shared layout context (not a local hook) is what makes
    // this update live when the picker changes it in the same tab.
    const data = useMemo(() => {
        const name = workspaces.find(w => w.id === selectedWorkspaceId)?.name
        return filterDashboardByWorkspace(dashboard, selectedWorkspaceId, projects, name)
    }, [dashboard, selectedWorkspaceId, projects, workspaces])

    if (data.projectCount === 0) {
        return <CenteredMessage text="No projects yet. Create one to get started." />
    }

    return <DashboardBody data={data} />
}

Dashboard.layout = [AppLayout]
