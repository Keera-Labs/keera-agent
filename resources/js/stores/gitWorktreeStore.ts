import { defineStore } from 'pinia'
import { reactive } from 'vue'

const STORAGE_KEY = 'keera.git.worktree'

function readSaved(): Record<number, string> {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
        return saved && typeof saved === 'object' ? saved : {}
    } catch {
        return {}
    }
}

/** The worktree each project's Source Control panel is showing, remembered across reloads. */
export const useGitWorktreeStore = defineStore('gitWorktree', () => {
    const selected = reactive<Record<number, string>>(readSaved())

    function select(projectId: number, path: string | null) {
        if (path === null) delete selected[projectId]
        else selected[projectId] = path
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(selected))
        } catch {}
    }

    return { selected, select }
})
