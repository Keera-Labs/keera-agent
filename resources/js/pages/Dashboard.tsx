import { usePage } from '@inertiajs/react'
import AppLayout from '@/layouts/AppLayout'
import { CenteredMessage, DashboardBody } from '@/components/Dashboard'
import type { DashboardData } from '@/components/Dashboard'

export type * from '@/components/Dashboard/types'

// Workspace overview served at "/" via Inertia props.
export default function Dashboard() {
    const { dashboard } = usePage<{ dashboard: DashboardData }>().props

    if (dashboard.projectCount === 0) {
        return <CenteredMessage text="No projects yet. Create one to get started." />
    }

    return <DashboardBody data={dashboard} />
}

Dashboard.layout = [AppLayout]
