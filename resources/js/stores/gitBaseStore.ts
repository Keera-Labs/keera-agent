import { defineStore } from 'pinia'
import { reactive } from 'vue'

const STORAGE_KEY = 'keera.git.base'

function readSaved(): Record<number, string> {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
        return saved && typeof saved === 'object' ? saved : {}
    } catch {
        return {}
    }
}

export const useGitBaseStore = defineStore('gitBase', () => {
    const selected = reactive<Record<number, string>>(readSaved())

    function select(projectId: number, base: string | null) {
        if (base === null) delete selected[projectId]
        else selected[projectId] = base
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(selected))
        } catch {}
    }

    return { selected, select }
})
