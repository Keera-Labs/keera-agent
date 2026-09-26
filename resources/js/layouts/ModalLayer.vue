<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import ConfirmDeleteWorkspaceModal from '@/components/modals/ConfirmDeleteWorkspaceModal.vue'
import ProjectSearchModal from '@/components/modals/ProjectSearchModal.vue'
import useAllProjects from '@/queries/allProjectsQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const layout = useAppLayoutStore()
const { showGlobalSettings, showProjectSearch, migratingModal } = storeToRefs(layout)
const workspaceStore = useWorkspaceStore()
const searchProjects = useAllProjects(showProjectSearch)

// Modals not ported yet keep their open state wired and say so instead of failing silently.
const pendingModal = computed(() => {
    if (showGlobalSettings.value) return 'Global settings'
    return migratingModal.value
})

function close() {
    showGlobalSettings.value = false
    migratingModal.value = null
}

function onWorkspaceDeleted(workspaceId: number) {
    // The deleted workspace can't stay selected: its project filter would match nothing.
    if (workspaceStore.currentWorkspaceId === workspaceId) workspaceStore.setCurrentWorkspaceId(null)
    layout.handleWorkspaceDeleted()
}
</script>

<template>
    <ConfirmDeleteWorkspaceModal
        v-if="workspaceStore.deletingWorkspace"
        :workspace="workspaceStore.deletingWorkspace"
        @close="workspaceStore.setDeletingWorkspace(null)"
        @deleted="onWorkspaceDeleted"
    />

    <ProjectSearchModal
        v-if="showProjectSearch"
        :projects="searchProjects"
        @close="showProjectSearch = false"
        @select="project => router.visit(`/${project.slug}`)"
    />

    <div
        v-if="pendingModal"
        role="status"
        class="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-modal border border-stroke rounded-lg px-4 py-3 text-[13px] text-zinc-500 shadow-lg"
    >
        <span><span class="font-semibold text-zinc-900">{{ pendingModal }}</span> is being migrated to Vue.</span>
        <button type="button" class="cursor-pointer text-zinc-900 font-semibold" @click="close">Dismiss</button>
    </div>
</template>
