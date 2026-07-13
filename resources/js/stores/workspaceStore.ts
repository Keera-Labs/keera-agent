import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface WorkspaceState {
    // Sidebar workspace filter, shared across the sidebar and dashboard. A store
    // (not per-component useLocalStorage) so both read one reactive source and
    // stay in sync within a tab. null = "All Projects".
    currentWorkspaceId: number | null
    setCurrentWorkspaceId: (id: number | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
    persist(
        set => ({
            currentWorkspaceId: null,
            setCurrentWorkspaceId: id => set({ currentWorkspaceId: id }),
        }),
        { name: 'keera:currentWorkspaceId' },
    ),
)
