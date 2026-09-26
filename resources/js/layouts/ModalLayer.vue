<script setup lang="ts">
import { useQueryCache } from '@pinia/colada'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import ConfirmDeleteWorkspaceModal from '@/components/modals/ConfirmDeleteWorkspaceModal.vue'
import DefaultPermissionsModal from '@/components/modals/DefaultPermissionsModal.vue'
import GlobalSettingsModal from '@/components/modals/GlobalSettingsModal.vue'
import ProjectPermissionsModal from '@/components/modals/ProjectPermissionsModal.vue'
import SystemPromptModal from '@/components/modals/SystemPromptModal.vue'
import { PROJECTS_QUERY_KEY } from '@/queries/projectsQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const layout = useAppLayoutStore()
const {
    showGlobalSettings,
    showDefaultPermissions,
    showProjectSearch,
    migratingModal,
    systemPromptProject,
    permissionsProject,
} = storeToRefs(layout)
const workspaceStore = useWorkspaceStore()
const queryCache = useQueryCache()

// Modals not ported yet keep their open state wired and say so instead of failing silently.
const pendingModal = computed(() => {
    if (showProjectSearch.value) return 'Project search'
    return migratingModal.value
})

function closePending() {
    showProjectSearch.value = false
    migratingModal.value = null
}

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
    <div
        v-if="pendingModal"
        role="status"
        class="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-modal border border-stroke rounded-lg px-4 py-3 text-[13px] text-zinc-500 shadow-lg"
    >
        <span><span class="font-semibold text-zinc-900">{{ pendingModal }}</span> is being migrated to Vue.</span>
        <button type="button" class="cursor-pointer text-zinc-900 font-semibold" @click="closePending">Dismiss</button>
    </div>
</template>
