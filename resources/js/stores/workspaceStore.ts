import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import type { Workspace } from '@/types/type'

// Same key and `{ state, version }` shape the previous zustand `persist` store
// wrote, so users keep their selected workspace across the migration.
const STORAGE_KEY = 'keera:currentWorkspaceId'

function readPersistedWorkspaceId(): number | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const id = raw ? JSON.parse(raw)?.state?.currentWorkspaceId : null
        return typeof id === 'number' ? id : null
    } catch {
        return null
    }
}

export const useWorkspaceStore = defineStore('workspace', () => {
    // Sidebar workspace filter, shared across the sidebar and dashboard.
    // null = "All Projects".
    const currentWorkspaceId = ref<number | null>(readPersistedWorkspaceId())
    // Workspace pending delete confirmation, shared between the sidebar (sets
    // it) and the modal layer (renders the confirm modal for it).
    const deletingWorkspace = shallowRef<Workspace | null>(null)

    watch(currentWorkspaceId, id => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { currentWorkspaceId: id }, version: 0 }))
        } catch {
            // Storage unavailable (e.g. private mode): the selection just won't persist.
        }
    })

    function setCurrentWorkspaceId(id: number | null) {
        currentWorkspaceId.value = id
    }

    function setDeletingWorkspace(workspace: Workspace | null) {
        deletingWorkspace.value = workspace
    }

    return { currentWorkspaceId, setCurrentWorkspaceId, deletingWorkspace, setDeletingWorkspace }
})
