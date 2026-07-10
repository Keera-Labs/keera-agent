import AppLayout from '@/layouts/AppLayout'
import { ProjectLayout } from '@/layouts/ProjectLayout'
import { DashboardView } from '@/layouts/views/DashboardView'
import { dashboardPlaceholder } from '@/pages/dashboard/placeholder'

export default function Dashboard() {
    return <DashboardView data={dashboardPlaceholder} />
}

// Nested persistent layouts — see Home.tsx / Tasks.tsx for why both must be listed here.
Dashboard.layout = [AppLayout, ProjectLayout]
