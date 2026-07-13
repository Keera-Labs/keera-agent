import { create } from 'zustand'

// Shared selection for the sidebar workspace picker. Lives in a store (not
// per-component state) so the sidebar and dashboard read one source and both
// re-render when it changes within a tab. Persisted under the same localStorage
// key the picker has always used, so existing selections survive.
const STORAGE_KEY = 'keera:selectedWorkspaceId'

function readPersisted(): number | null {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw !== null ? (JSON.parse(raw) as number) : null
    } catch {
        return null
    }
}

function persist(id: number | null) {
    try {
        if (id === null) window.localStorage.removeItem(STORAGE_KEY)
        else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(id))
    } catch {
        // localStorage unavailable (private mode, quota) — degrade to in-memory
    }
}

interface WorkspaceStore {
    currentWorkspaceId: number | null
    setCurrentWorkspaceId: (id: number | null) => void
}

export const useWorkspaceStore = create<WorkspaceStore>()(set => ({
    currentWorkspaceId: readPersisted(),
    setCurrentWorkspaceId: id => {
        persist(id)
        set({ currentWorkspaceId: id })
    },
}))
