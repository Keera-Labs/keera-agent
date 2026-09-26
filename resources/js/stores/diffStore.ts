import { router } from '@inertiajs/vue3'
import { defineStore, storeToRefs } from 'pinia'
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import type { GitDiffRequest, GitTarget } from '@/queries/gitQuery'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

export type DiffTab = GitDiffRequest & {
    id: string
    name: string
    /** Names the worktree in the tab when it is not the project's own checkout. */
    worktreeLabel: string | null
}

const tabId = ({ target, path, staged }: GitDiffRequest) =>
    `${target.worktree ?? ''}\0${staged ? 'staged' : 'unstaged'}\0${path}`

/** Read-only diff tabs, shown in the editor area beside the file tabs. */
export const useDiffStore = defineStore('diff', () => {
    const { activeProject } = storeToRefs(useProjectStore())
    const editor = useEditorStore()

    const tabsByProject = reactive<Record<number, DiffTab[]>>({})
    const activeId = ref<string | null>(null)
    const sideBySide = ref(true)

    const projectTabs = computed(() =>
        activeProject.value ? tabsByProject[activeProject.value.id] ?? [] : [],
    )
    const activeTab = computed(() => projectTabs.value.find(t => t.id === activeId.value) ?? null)

    function activate(tab: DiffTab | null) {
        // The editor area shows one tab at a time: a diff takes over from the file editor.
        if (tab) editor.activate(tab.target.projectId, null)
        activeId.value = tab?.id ?? null
    }

    function open(target: GitTarget, path: string, staged: boolean, worktreeLabel: string | null = null) {
        const request = { target, path, staged }
        const id = tabId(request)
        const tabs = (tabsByProject[target.projectId] ??= [])
        let tab = tabs.find(t => t.id === id)
        if (!tab) {
            tab = { ...request, id, name: path.split('/').pop() || path, worktreeLabel }
            tabs.push(tab)
        }
        activate(tab)
    }

    function close(projectId: number, id: string) {
        const tabs = tabsByProject[projectId] ?? []
        const index = tabs.findIndex(t => t.id === id)
        if (index === -1) return
        tabs.splice(index, 1)
        if (activeId.value === id) activate(tabs[index] ?? tabs[index - 1] ?? null)
    }

    // Sync, so a file re-activated in the same tick a diff opened still takes the area back.
    watch(() => editor.activeTab, fileTab => { if (fileTab) activeId.value = null }, { flush: 'sync' })

    const stopBefore = router.on('before', event => {
        // Partial reloads refresh props in place; any real visit brings its page to the front.
        if (event.detail.visit.only.length === 0) activeId.value = null
    })
    onScopeDispose(stopBefore)

    return { tabsByProject, projectTabs, activeTab, sideBySide, open, activate, close }
})
