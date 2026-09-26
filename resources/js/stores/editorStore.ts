import { router } from '@inertiajs/vue3'
import { useQueryCache } from '@pinia/colada'
import { defineStore, storeToRefs } from 'pinia'
import { computed, onScopeDispose, reactive, ref } from 'vue'
import { loadMonaco, modelUri, type TextModel } from '@/editor/monaco'
import { FileContentError, fileContentQuery, saveFileContent, type FileContent } from '@/queries/fileContentQuery'
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

type Buffer = { model: TextModel; savedVersion: number; dispose: () => void }

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

    function modelFor(tab: EditorTab): TextModel | null {
        return buffers.get(bufferKey(tab.projectId, tab.path))?.model ?? null
    }

    function hasDirtyTabs(projectId?: number): boolean {
        const lists = projectId === undefined ? Object.values(tabsByProject) : [tabsByProject[projectId] ?? []]
        return lists.some(tabs => tabs.some(t => t.dirty))
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
        active.value = path === null ? null : { projectId, path }
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
            const buffer: Buffer = { model, savedVersion: model.getAlternativeVersionId(), dispose: () => {} }
            const listener = model.onDidChangeContent(() => {
                const tab = findTab(projectId, path)
                if (tab) tab.dirty = model.getAlternativeVersionId() !== buffer.savedVersion
            })
            buffer.dispose = () => { listener.dispose(); model.dispose() }
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

    async function save(projectId: number, path: string) {
        const tab = findTab(projectId, path)
        const buffer = buffers.get(bufferKey(projectId, path))
        if (!tab || !buffer || tab.saving) return
        const { model } = buffer
        const version = model.getAlternativeVersionId()
        tab.saving = true
        try {
            const saved = await saveFileContent(projectId, path, model.getValue(), tab.etag)
            tab.etag = saved.etag
            buffer.savedVersion = version
            // Edits typed while the request was in flight keep the tab dirty.
            tab.dirty = model.getAlternativeVersionId() !== version
            tab.conflict = false
            tab.error = null
        } catch (e) {
            if (e instanceof FileContentError && e.status === 409) tab.conflict = true
            else tab.error = e instanceof Error ? e.message : String(e)
        } finally {
            tab.saving = false
        }
    }

    async function resolveConflict(projectId: number, path: string, choice: 'reload' | 'overwrite') {
        const tab = findTab(projectId, path)
        const buffer = buffers.get(bufferKey(projectId, path))
        if (!tab || !buffer) return
        try {
            const file = await readFile(projectId, path)
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
        } catch (e) {
            tab.error = e instanceof Error ? e.message : String(e)
        }
    }

    /** Closes a tab, asking first when it has unsaved changes. Returns false if the user kept it open. */
    function close(projectId: number, path: string): boolean {
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

    function warnOnUnload(e: BeforeUnloadEvent) {
        if (hasDirtyTabs()) e.preventDefault()
    }

    const stopBefore = router.on('before', event => {
        const { visit } = event.detail
        const project = activeProject.value
        const leavingProject = project !== null && visit.url.pathname.split('/')[1] !== project.slug
        if (leavingProject && hasDirtyTabs(project.id)
            && !window.confirm(`${project.name} has unsaved changes. Leave the project anyway?`)) {
            return false
        }
        // Partial reloads refresh props in place; any real visit brings its page to the front.
        if (visit.only.length === 0) active.value = null
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
        open,
        activate,
        save,
        resolveConflict,
        close,
    }
})
