import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Workspace } from '@/types/type'

interface WorkspaceState {
    // Sidebar workspace filter, shared across the sidebar and dashboard. A store
    // (not per-component useLocalStorage) so both read one reactive source and
    // stay in sync within a tab. null = "All Projects".
    currentWorkspaceId: number | null
    setCurrentWorkspaceId: (id: number | null) => void
    // Workspace pending delete confirmation, shared between the sidebar (sets it)
    // and ModalLayer (renders the confirm modal for it).
    deletingWorkspace: Workspace | null
    setDeletingWorkspace: (w: Workspace | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
    persist(
        set => ({
            currentWorkspaceId: null,
            setCurrentWorkspaceId: id => set({ currentWorkspaceId: id }),
            deletingWorkspace: null,
            setDeletingWorkspace: w => set({ deletingWorkspace: w }),
        }),
        {
            name: 'keera:currentWorkspaceId',
            partialize: state => ({ currentWorkspaceId: state.currentWorkspaceId }),
        },
    ),
)
