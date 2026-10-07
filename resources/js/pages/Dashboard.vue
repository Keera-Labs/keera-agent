<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import useProjects from '@/queries/projectsQuery'
import useWorkspaces from '@/queries/workspacesQuery'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { CenteredMessage, DashboardBody, scopeDashboard } from '@/pages/dashboard/index'
import type { DashboardData } from '@/pages/dashboard/index'

// Workspace overview served at "/" via Inertia props. Rendered inside the
// default AppLayout configured in app.ts.
const page = usePage<{ dashboard: DashboardData }>()
const { currentWorkspaceId } = storeToRefs(useWorkspaceStore())
const { workspaces } = useWorkspaces()
const { projects } = useProjects()

// Reading the selection from the shared store keeps this live when the
// sidebar's workspace picker changes in the same tab.
const data = computed(() =>
    scopeDashboard(page.props.dashboard, currentWorkspaceId.value, projects.value, workspaces.value),
)
</script>

<template>
    <CenteredMessage v-if="data.projectCount === 0" text="No projects yet. Create one to get started." />
    <DashboardBody v-else :data="data" />
</template>
