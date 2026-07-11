import { usePage } from '@inertiajs/react'
import AppLayout from '@/layouts/AppLayout'
import { CenteredMessage, DashboardBody } from '@/pages/dashboard/index'
import type { DashboardData } from '@/pages/dashboard/index'

export type * from '@/pages/dashboard/types'

// Workspace overview served at "/" via Inertia props.
export default function Dashboard() {
    const { dashboard } = usePage<{ dashboard: DashboardData }>().props

    if (dashboard.projectCount === 0) {
        return <CenteredMessage text="No projects yet. Create one to get started." />
    }

    return <DashboardBody data={dashboard} />
}

Dashboard.layout = [AppLayout]
