<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const { showGlobalSettings, showProjectSearch } = storeToRefs(useAppLayoutStore())
const workspaceStore = useWorkspaceStore()

// The global settings, project search and delete-workspace modals are not ported
// yet; the layer keeps their open state wired and says so instead of failing silently.
const pendingModal = computed(() => {
    if (showGlobalSettings.value) return 'Global settings'
    if (showProjectSearch.value) return 'Project search'
    if (workspaceStore.deletingWorkspace) return 'Delete workspace'
    return null
})

function close() {
    showGlobalSettings.value = false
    showProjectSearch.value = false
    workspaceStore.setDeletingWorkspace(null)
}
</script>

<template>
    <div
        v-if="pendingModal"
        role="status"
        class="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-modal border border-stroke rounded-lg px-4 py-3 text-[13px] text-zinc-500 shadow-lg"
    >
        <span><span class="font-semibold text-zinc-900">{{ pendingModal }}</span> is being migrated to Vue.</span>
        <button type="button" class="cursor-pointer text-zinc-900 font-semibold" @click="close">Dismiss</button>
    </div>
</template>
