<script setup lang="ts">
import { Columns2, FileDiff, Rows2, TriangleAlert } from '@lucide/vue'
import { useQueryCache } from '@pinia/colada'
import type * as Monaco from 'monaco-editor'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EDITOR_THEME, loadMonaco, type MonacoApi, type TextModel } from '@/editor/monaco'
import { gitKeys, GitRequestError, useGitDiff, type GitDiff } from '@/queries/gitQuery'
import { useDiffStore } from '@/stores/diffStore'
import { useEditorSettingsStore } from '@/stores/editorSettingsStore'

const diffs = useDiffStore()
const { activeTab, sideBySide } = storeToRefs(diffs)
const { font } = storeToRefs(useEditorSettingsStore())
const queryCache = useQueryCache()

const diffRequest = computed(() => {
    const tab = activeTab.value
    return tab ? { target: tab.target, path: tab.path, staged: tab.staged } : null
})
const query = useGitDiff(diffRequest)
const diff = query.data

const placeholder = computed(() => {
    const current = diff.value
    if (current?.binary) return 'Binary file: no text diff to show.'
    if (current?.too_large) return 'File too large to diff (over 1 MB).'
    return null
})

const notice = computed(() => {
    const current = diff.value
    if (!current) return null
    if (current.status === 'U') return 'Merge conflict: the working file is compared with HEAD.'
    if (current.original_path) return `Renamed from ${current.original_path}`
    if (current.original === null && current.modified !== null) return 'New file'
    if (current.modified === null && current.original !== null) return 'Deleted file'
    return null
})

const compared = computed(() => (activeTab.value?.staged ? 'HEAD ↔ Index' : 'Index ↔ Working tree'))

const host = ref<HTMLElement | null>(null)
let monaco: MonacoApi | null = null
let editor: Monaco.editor.IStandaloneDiffEditor | null = null
let models: { original: TextModel; modified: TextModel } | null = null
let modelSeq = 0
let unmounted = false

function disposeModels() {
    models?.original.dispose()
    models?.modified.dispose()
    models = null
}

function render(current: GitDiff | undefined) {
    if (!monaco || !editor) return
    if (!current || current.binary || current.too_large) {
        editor.setModel(null)
        disposeModels()
        return
    }
    const original = current.original ?? ''
    const modified = current.modified ?? ''
    // A background refetch with the same text must not reset the reader's scroll position.
    if (models && models.original.getValue() === original && models.modified.getValue() === modified) return

    // Each side needs its own URI; the file's extension lets Monaco pick a language when the API names none.
    const uri = (side: string) => monaco!.Uri.from({ scheme: 'git-diff', path: `/${++modelSeq}/${side}/${current.path}` })
    const language = current.language ?? undefined
    const next = {
        original: monaco.editor.createModel(original, language, uri('original')),
        modified: monaco.editor.createModel(modified, language, uri('modified')),
    }
    editor.setModel(next)
    disposeModels()
    models = next
}

onMounted(async () => {
    const api = await loadMonaco()
    if (unmounted || !host.value) return
    monaco = api
    editor = api.editor.createDiffEditor(host.value, {
        theme: EDITOR_THEME,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide.value,
        useInlineViewWhenSpaceIsLimited: false,
        automaticLayout: true,
        ...font.value,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
    })
    render(diff.value)
})

watch(diff, render)
watch(font, next => editor?.updateOptions(next))
watch(sideBySide, value => editor?.updateOptions({ renderSideBySide: value }))

// A 404 means the file left that list (staged, committed or reverted elsewhere): refresh the panel and drop the tab.
watch(query.error, error => {
    const tab = activeTab.value
    if (!(error instanceof GitRequestError) || error.status !== 404 || !tab) return
    queryCache.invalidateQueries({ key: gitKeys.status(tab.target), exact: true })
    diffs.close(tab.target.projectId, tab.id)
})

onBeforeUnmount(() => {
    unmounted = true
    editor?.dispose()
    editor = null
    disposeModels()
})

const toggleClass = 'h-5 px-1.5 flex items-center gap-1 rounded cursor-pointer transition-colors'
</script>

<template>
    <section class="absolute inset-0 z-10 flex flex-col bg-white" aria-label="Diff" data-testid="diff-pane">
        <div v-if="activeTab" class="flex items-center gap-2 h-7 px-3 shrink-0 border-b border-stroke text-[12px] text-zinc-500">
            <FileDiff :size="13" class="shrink-0 text-accent" />
            <span class="truncate font-mono text-zinc-700" data-testid="diff-path">{{ activeTab.path }}</span>
            <span class="shrink-0" data-testid="diff-compared">{{ compared }}</span>
            <span v-if="activeTab.worktreeLabel" class="shrink-0 truncate max-w-40 px-1.5 rounded bg-zinc-100 text-zinc-600">
                {{ activeTab.worktreeLabel }}
            </span>
            <span v-if="notice" class="shrink-0 truncate text-zinc-500" data-testid="diff-notice">· {{ notice }}</span>
            <div class="ml-auto shrink-0 flex items-center gap-0.5" role="group" aria-label="Diff layout">
                <button
                    type="button"
                    data-testid="diff-side-by-side"
                    :aria-pressed="sideBySide"
                    :class="[toggleClass, sideBySide ? 'bg-zinc-200/80 text-zinc-800' : 'hover:bg-zinc-100']"
                    @click="sideBySide = true"
                >
                    <Columns2 :size="12" /> Side by side
                </button>
                <button
                    type="button"
                    data-testid="diff-inline"
                    :aria-pressed="!sideBySide"
                    :class="[toggleClass, !sideBySide ? 'bg-zinc-200/80 text-zinc-800' : 'hover:bg-zinc-100']"
                    @click="sideBySide = false"
                >
                    <Rows2 :size="12" /> Inline
                </button>
            </div>
        </div>

        <p v-if="!diff && query.isLoading.value" class="px-3 py-2 text-[12px] text-zinc-400" data-testid="diff-loading">Loading diff…</p>
        <div
            v-else-if="!diff && query.error.value"
            role="alert"
            data-testid="diff-error"
            class="flex items-center gap-2 px-3 py-2 text-[12px] text-danger"
        >
            <TriangleAlert :size="13" class="shrink-0" />
            <span class="flex-1">{{ query.error.value.message }}</span>
            <button type="button" class="text-accent hover:underline cursor-pointer" @click="query.refetch()">Try again</button>
        </div>
        <div
            v-else-if="placeholder"
            data-testid="diff-placeholder"
            class="flex-1 flex flex-col items-center justify-center gap-2 text-[13px] text-zinc-500"
        >
            <FileDiff :size="22" class="text-zinc-400" />
            {{ placeholder }}
        </div>

        <div v-show="diff && !placeholder" ref="host" class="flex-1 min-h-0" />
    </section>
</template>
