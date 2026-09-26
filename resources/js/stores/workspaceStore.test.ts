import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useWorkspaceStore } from './workspaceStore'

const KEY = 'keera:currentWorkspaceId'

function memoryStorage() {
    const data = new Map<string, string>()
    return {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
    }
}

describe('useWorkspaceStore', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage())
        setActivePinia(createPinia())
    })

    afterEach(() => vi.unstubAllGlobals())

    it('restores the selection written by the previous zustand persist store', () => {
        localStorage.setItem(KEY, JSON.stringify({ state: { currentWorkspaceId: 7 }, version: 0 }))
        expect(useWorkspaceStore().currentWorkspaceId).toBe(7)
    })

    it('falls back to "All Projects" when nothing valid is stored', () => {
        localStorage.setItem(KEY, 'not json')
        expect(useWorkspaceStore().currentWorkspaceId).toBeNull()
    })

    it('persists a new selection in the same shape', async () => {
        useWorkspaceStore().setCurrentWorkspaceId(3)
        await nextTick()
        expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ state: { currentWorkspaceId: 3 }, version: 0 })
    })
})
