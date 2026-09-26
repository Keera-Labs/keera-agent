import { router } from '@inertiajs/vue3'
import { useQueryCache } from '@pinia/colada'
import { defineStore, storeToRefs } from 'pinia'
import { computed, onScopeDispose, reactive, ref } from 'vue'
import { loadMonaco, modelUri, type TextModel } from '@/editor/monaco'
import { FileContentError, fileContentQuery, saveFileContent, type FileContent, type SavedFile } from '@/queries/fileContentQuery'
import { useProjectStore } from '@/stores/projectStore'

export type EditorTab = {
    projectId: number
    path: string
    name: string
    etag: string
    dirty: boolean
    saving: boolean
    /** The file changed on disk since it was loaded; the last save was rejected. */
    conflict: boolean
    error: string | null
}

export type OpenError = { projectId: number; path: string; message: string }

export type SaveStatus = 'saving' | 'conflict' | 'error' | 'unsaved' | 'saved'

export function saveStatus(tab: EditorTab): SaveStatus {
    if (tab.saving) return 'saving'
    if (tab.conflict) return 'conflict'
    if (tab.error !== null) return 'error'
    return tab.dirty ? 'unsaved' : 'saved'
}

export const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
    saving: 'Saving…',
    conflict: 'Not saved: changed on disk',
    error: 'Save failed',
    unsaved: 'Unsaved changes',
    saved: 'Saved',
}

export const AUTO_SAVE_DELAY_MS = 1000

// Browsers cap the combined body size of in-flight keepalive requests at 64 KiB.
const KEEPALIVE_BUDGET_BYTES = 60 * 1024

type Buffer = {
    model: TextModel
    savedVersion: number
    autoSaveTimer: ReturnType<typeof setTimeout> | null
    inFlight: Promise<boolean> | null
    followUp: boolean
    dispose: () => void
}

const bufferKey = (projectId: number, path: string) => `${projectId}:${path}`

export const useEditorStore = defineStore('editor', () => {
    const queryCache = useQueryCache()
    const { activeProject } = storeToRefs(useProjectStore())

    // Tabs are kept per project so they survive navigating between projects.
    const tabsByProject = reactive<Record<number, EditorTab[]>>({})
    const active = ref<{ projectId: number; path: string } | null>(null)
    const openError = ref<OpenError | null>(null)

    // Monaco models are large mutable objects; they stay outside Vue's reactivity.
    const buffers = new Map<string, Buffer>()
    const opening = new Set<string>()

    const projectTabs = computed(() =>
        activeProject.value ? tabsByProject[activeProject.value.id] ?? [] : [],
    )
    const activeTab = computed(() => {
        const current = active.value
        if (!current || current.projectId !== activeProject.value?.id) return null
        return findTab(current.projectId, current.path)
    })

    function findTab(projectId: number, path: string): EditorTab | null {
        return tabsByProject[projectId]?.find(t => t.path === path) ?? null
    }

    function tabsOf(projectId?: number): EditorTab[] {
        return projectId === undefined ? Object.values(tabsByProject).flat() : tabsByProject[projectId] ?? []
    }

    /** False once the buffer's tab was closed, e.g. while a request for it was in flight. */
    function isLive(buffer: Buffer): boolean {
        return !buffer.model.isDisposed()
    }

    function modelFor(tab: EditorTab): TextModel | null {
        return buffers.get(bufferKey(tab.projectId, tab.path))?.model ?? null
    }

    function hasDirtyTabs(projectId?: number): boolean {
        return tabsOf(projectId).some(t => t.dirty)
    }

    /** Dirty tabs that auto-save cannot bring to disk on its own: their last save failed or conflicted. */
    function hasUnsavedWork(projectId?: number): boolean {
        return tabsOf(projectId).some(t => t.dirty && (t.conflict || t.error !== null))
    }

    async function readFile(projectId: number, path: string): Promise<FileContent> {
        const entry = queryCache.ensure(fileContentQuery({ projectId, path }))
        try {
            const state = await queryCache.fetch(entry)
            return state.data as FileContent
        } finally {
            queryCache.remove(entry)
        }
    }

    function activate(projectId: number, path: string | null) {
        const previous = active.value
        if (previous && (previous.projectId !== projectId || previous.path !== path)) {
            void flush(previous.projectId, previous.path)
        }
        active.value = path === null ? null : { projectId, path }
    }

    function cancelAutoSave(buffer: Buffer) {
        if (buffer.autoSaveTimer !== null) clearTimeout(buffer.autoSaveTimer)
        buffer.autoSaveTimer = null
    }

    function scheduleAutoSave(projectId: number, path: string, buffer: Buffer) {
        cancelAutoSave(buffer)
        buffer.autoSaveTimer = setTimeout(() => {
            buffer.autoSaveTimer = null
            void flush(projectId, path)
        }, AUTO_SAVE_DELAY_MS)
    }

    async function open(projectId: number, path: string) {
        openError.value = null
        if (findTab(projectId, path)) {
            activate(projectId, path)
            return
        }
        const key = bufferKey(projectId, path)
        if (opening.has(key)) return
        opening.add(key)
        try {
            const [monaco, file] = await Promise.all([loadMonaco(), readFile(projectId, path)])
            const uri = modelUri(monaco, projectId, path)
            monaco.editor.getModel(uri)?.dispose()
            const model = monaco.editor.createModel(file.content, undefined, uri)
            const buffer: Buffer = {
                model,
                savedVersion: model.getAlternativeVersionId(),
                autoSaveTimer: null,
                inFlight: null,
                followUp: false,
                dispose: () => {},
            }
            const listener = model.onDidChangeContent(() => {
                const tab = findTab(projectId, path)
                if (!tab) return
                tab.dirty = model.getAlternativeVersionId() !== buffer.savedVersion
                // A conflicted file waits for the user's choice: auto-save must never overwrite it.
                if (tab.dirty && !tab.conflict) scheduleAutoSave(projectId, path, buffer)
            })
            buffer.dispose = () => {
                cancelAutoSave(buffer)
                listener.dispose()
                model.dispose()
            }
            buffers.set(key, buffer)

            ;(tabsByProject[projectId] ??= []).push({
                projectId,
                path,
                name: path.split('/').pop() || path,
                etag: file.etag,
                dirty: false,
                saving: false,
                conflict: false,
                error: null,
            })
            activate(projectId, path)
        } catch (e) {
            openError.value = { projectId, path, message: e instanceof Error ? e.message : String(e) }
        } finally {
            opening.delete(key)
        }
    }

    async function saveOnce(tab: EditorTab, buffer: Buffer, keepalive: boolean): Promise<boolean> {
        if (!isLive(buffer)) return false
        const { model } = buffer
        const version = model.getAlternativeVersionId()
        tab.saving = true
        let outcome: { saved: SavedFile } | { error: unknown }
        try {
            outcome = { saved: await saveFileContent(tab.projectId, tab.path, model.getValue(), tab.etag, { keepalive }) }
        } catch (error) {
            outcome = { error }
        }
        tab.saving = false
        if (!isLive(buffer)) return false

        if ('error' in outcome) {
            const { error } = outcome
            if (error instanceof FileContentError && error.status === 409) {
                tab.conflict = true
                cancelAutoSave(buffer)
            } else {
                tab.error = error instanceof Error ? error.message : String(error)
            }
            return false
        }
        tab.etag = outcome.saved.etag
        buffer.savedVersion = version
        // Edits typed while the request was in flight keep the tab dirty.
        tab.dirty = model.getAlternativeVersionId() !== version
        tab.conflict = false
        tab.error = null
        return true
    }

    /**
     * Saves now. Saves of one file never overlap: asking while one is in flight
     * queues a single follow-up, sent with the etag the first one returns.
     * Resolves to whether the save and any follow-up succeeded.
     */
    function save(projectId: number, path: string, { keepalive = false } = {}): Promise<boolean> {
        const tab = findTab(projectId, path)
        const buffer = buffers.get(bufferKey(projectId, path))
        if (!tab || !buffer) return Promise.resolve(true)
        cancelAutoSave(buffer)
        if (buffer.inFlight) {
            buffer.followUp = true
            return buffer.inFlight
        }
        const run = async () => {
            let ok: boolean
            do {
                buffer.followUp = false
                ok = await saveOnce(tab, buffer, keepalive)
            } while (ok && buffer.followUp && tab.dirty)
            return ok
        }
        buffer.inFlight = run().finally(() => { buffer.inFlight = null })
        return buffer.inFlight
    }

    /** Saves pending edits right away. Resolves to true when nothing is left unsaved. */
    function flush(projectId: number, path: string): Promise<boolean> {
        const tab = findTab(projectId, path)
        const buffer = buffers.get(bufferKey(projectId, path))
        if (!tab || !buffer) return Promise.resolve(true)
        cancelAutoSave(buffer)
        if (tab.conflict) return Promise.resolve(false)
        if (!tab.dirty) return buffer.inFlight ?? Promise.resolve(true)
        return save(projectId, path)
    }

    async function resolveConflict(projectId: number, path: string, choice: 'reload' | 'overwrite') {
        const tab = findTab(projectId, path)
        const buffer = buffers.get(bufferKey(projectId, path))
        if (!tab || !buffer) return
        try {
            const file = await readFile(projectId, path)
            if (!isLive(buffer)) return
            tab.etag = file.etag
            tab.conflict = false
            tab.error = null
            if (choice === 'overwrite') {
                await save(projectId, path)
                return
            }
            buffer.model.setValue(file.content)
            buffer.savedVersion = buffer.model.getAlternativeVersionId()
            tab.dirty = false
            cancelAutoSave(buffer)
        } catch (e) {
            tab.error = e instanceof Error ? e.message : String(e)
        }
    }

    /**
     * Closes a tab, saving pending edits first and asking only when they could
     * not be saved. Resolves to false if the user kept it open.
     */
    async function close(projectId: number, path: string): Promise<boolean> {
        await flush(projectId, path)
        const tabs = tabsByProject[projectId] ?? []
        const index = tabs.findIndex(t => t.path === path)
        if (index === -1) return true
        const tab = tabs[index]
        if (tab.dirty && !window.confirm(`${tab.name} has unsaved changes. Close it and discard them?`)) return false

        const key = bufferKey(projectId, path)
        buffers.get(key)?.dispose()
        buffers.delete(key)
        tabs.splice(index, 1)

        if (active.value?.projectId === projectId && active.value.path === path) {
            const neighbour = tabs[index] ?? tabs[index - 1]
            activate(projectId, neighbour?.path ?? null)
        }
        return true
    }

    /** Drops a deleted project's tabs without asking: there is nothing left to save them to. */
    function closeProject(projectId: number) {
        for (const tab of tabsByProject[projectId] ?? []) {
            const key = bufferKey(projectId, tab.path)
            buffers.get(key)?.dispose()
            buffers.delete(key)
        }
        delete tabsByProject[projectId]
        if (active.value?.projectId === projectId) active.value = null
        if (openError.value?.projectId === projectId) openError.value = null
    }

    /**
     * Pending edits are sent with keepalive so they outlive the page; only work
     * that cannot be sent that way warrants the browser's leave prompt.
     */
    function warnOnUnload(e: BeforeUnloadEvent) {
        let budget = KEEPALIVE_BUDGET_BYTES
        let unsaved = false
        for (const tab of tabsOf()) {
            if (!tab.dirty) continue
            const buffer = buffers.get(bufferKey(tab.projectId, tab.path))
            if (!buffer || tab.conflict || tab.error !== null || buffer.inFlight) {
                unsaved = true
                continue
            }
            const size = new TextEncoder().encode(buffer.model.getValue()).length
            if (size > budget) {
                unsaved = true
                continue
            }
            budget -= size
            void save(tab.projectId, tab.path, { keepalive: true })
        }
        if (unsaved) e.preventDefault()
    }

    const stopBefore = router.on('before', event => {
        const { visit } = event.detail
        const project = activeProject.value
        const leavingProject = project !== null && visit.url.pathname.split('/')[1] !== project.slug
        if (leavingProject && hasUnsavedWork(project.id)
            && !window.confirm(`${project.name} has unsaved changes. Leave the project anyway?`)) {
            return false
        }
        // Partial reloads refresh props in place; any real visit brings its page to the front.
        if (visit.only.length === 0) {
            if (project) for (const tab of tabsOf(project.id)) void flush(project.id, tab.path)
            active.value = null
        }
    })

    window.addEventListener('beforeunload', warnOnUnload)
    onScopeDispose(() => {
        stopBefore()
        window.removeEventListener('beforeunload', warnOnUnload)
        for (const buffer of buffers.values()) buffer.dispose()
        buffers.clear()
    })

    return {
        tabsByProject,
        projectTabs,
        activeTab,
        openError,
        modelFor,
        hasDirtyTabs,
        hasUnsavedWork,
        open,
        activate,
        save,
        flush,
        resolveConflict,
        close,
        closeProject,
    }
})
