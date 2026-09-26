<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { useQueryCache } from '@pinia/colada'
import { storeToRefs } from 'pinia'
import ConfirmDeleteWorkspaceModal from '@/components/modals/ConfirmDeleteWorkspaceModal.vue'
import DefaultPermissionsModal from '@/components/modals/DefaultPermissionsModal.vue'
import GlobalSettingsModal from '@/components/modals/GlobalSettingsModal.vue'
import ProjectPermissionsModal from '@/components/modals/ProjectPermissionsModal.vue'
import ProjectSearchModal from '@/components/modals/ProjectSearchModal.vue'
import SystemPromptModal from '@/components/modals/SystemPromptModal.vue'
import SettingsModal from '@/layouts/settings/SettingsModal.vue'
import useAllProjects from '@/queries/allProjectsQuery'
import { PROJECTS_QUERY_KEY } from '@/queries/projectsQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const layout = useAppLayoutStore()
const {
    showGlobalSettings,
    showDefaultPermissions,
    showProjectSearch,
    settingsSection,
    systemPromptProject,
    permissionsProject,
} = storeToRefs(layout)
const workspaceStore = useWorkspaceStore()
const queryCache = useQueryCache()
const searchProjects = useAllProjects(showProjectSearch)

function onWorkspaceDeleted(workspaceId: number) {
    // The deleted workspace can't stay selected: its project filter would match nothing.
    if (workspaceStore.currentWorkspaceId === workspaceId) workspaceStore.setCurrentWorkspaceId(null)
    layout.handleWorkspaceDeleted()
}

function refreshProjects() {
    queryCache.invalidateQueries({ key: PROJECTS_QUERY_KEY })
}
</script>

<template>
    <ConfirmDeleteWorkspaceModal
        v-if="workspaceStore.deletingWorkspace"
        :workspace="workspaceStore.deletingWorkspace"
        @close="workspaceStore.setDeletingWorkspace(null)"
        @deleted="onWorkspaceDeleted"
    />
    <SettingsModal v-if="settingsSection" />
    <GlobalSettingsModal v-if="showGlobalSettings" @close="showGlobalSettings = false" />
    <DefaultPermissionsModal v-if="showDefaultPermissions" @close="showDefaultPermissions = false" />
    <SystemPromptModal
        v-if="systemPromptProject"
        :key="systemPromptProject.id"
        :project="systemPromptProject"
        @updated="refreshProjects"
        @close="systemPromptProject = null"
    />
    <ProjectPermissionsModal
        v-if="permissionsProject"
        :key="permissionsProject.id"
        :project="permissionsProject"
        @close="permissionsProject = null"
    />
    <ProjectSearchModal
        v-if="showProjectSearch"
        :projects="searchProjects"
        @close="showProjectSearch = false"
        @select="project => router.visit(`/${project.slug}`)"
    />
</template>
