<script setup lang="ts">
import type * as Monaco from 'monaco-editor'
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { EDITOR_THEME, loadMonaco, type TextModel } from '@/editor/monaco'
import { useEditorStore } from '@/stores/editorStore'

const editorStore = useEditorStore()
const { activeTab } = storeToRefs(editorStore)

const host = ref<HTMLElement | null>(null)
let editor: Monaco.editor.IStandaloneCodeEditor | null = null
let unmounted = false
// One editor is shared by all tabs, so each model's cursor and scroll are kept here.
const viewStates = new WeakMap<TextModel, Monaco.editor.ICodeEditorViewState | null>()

function showActiveModel() {
    if (!editor) return
    const previous = editor.getModel()
    if (previous && !previous.isDisposed()) viewStates.set(previous, editor.saveViewState())
    const next = activeTab.value ? editorStore.modelFor(activeTab.value) : null
    if (next === previous) return
    editor.setModel(next)
    if (!next) return
    const state = viewStates.get(next)
    if (state) editor.restoreViewState(state)
    editor.focus()
}

onMounted(async () => {
    const monaco = await loadMonaco()
    if (unmounted || !host.value) return
    editor = monaco.editor.create(host.value, {
        model: null,
        theme: EDITOR_THEME,
        automaticLayout: true,
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
    })
    showActiveModel()
})

watch(activeTab, showActiveModel)

// Capture phase: runs before Monaco's own key handling and outside it too, so
// the save shortcut works wherever focus is while a file is shown.
function onKeyDown(e: KeyboardEvent) {
    const tab = activeTab.value
    if (!tab || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
    e.preventDefault()
    e.stopPropagation()
    editorStore.save(tab.projectId, tab.path)
}

window.addEventListener('keydown', onKeyDown, true)
onBeforeUnmount(() => {
    unmounted = true
    window.removeEventListener('keydown', onKeyDown, true)
    editor?.dispose()
    editor = null
})

const bannerButton = 'h-6 px-2 rounded border text-[12px] cursor-pointer'
</script>

<template>
    <section class="absolute inset-0 z-10 flex flex-col bg-white" aria-label="Editor">
        <div v-if="activeTab" class="flex items-center gap-2 h-7 px-3 shrink-0 border-b border-stroke text-[12px] text-zinc-500">
            <span class="truncate font-mono" data-testid="editor-path">{{ activeTab.path }}</span>
            <span v-if="activeTab.saving" class="shrink-0">Saving…</span>
            <span v-else-if="activeTab.dirty" class="shrink-0">Unsaved changes</span>
        </div>

        <div
            v-if="activeTab?.conflict"
            role="alert"
            data-testid="editor-conflict"
            class="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-amber-200 bg-amber-50 text-[12px] text-amber-900"
        >
            <Icon name="info" :size="13" class="shrink-0" />
            <span class="flex-1">{{ activeTab.name }} changed on disk since you opened it. Your changes were not saved.</span>
            <button
                type="button"
                :class="[bannerButton, 'border-amber-300 bg-white hover:bg-amber-100']"
                @click="editorStore.resolveConflict(activeTab.projectId, activeTab.path, 'reload')"
            >
                Reload from disk
            </button>
            <button
                type="button"
                :class="[bannerButton, 'border-amber-600 bg-amber-600 text-white hover:bg-amber-700']"
                @click="editorStore.resolveConflict(activeTab.projectId, activeTab.path, 'overwrite')"
            >
                Overwrite
            </button>
        </div>

        <div
            v-else-if="activeTab?.error"
            role="alert"
            data-testid="editor-error"
            class="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-red-200 bg-red-50 text-[12px] text-danger"
        >
            <Icon name="info" :size="13" class="shrink-0" />
            <span class="flex-1">Could not save {{ activeTab.name }}: {{ activeTab.error }}</span>
            <button type="button" aria-label="Dismiss" class="p-0.5 rounded hover:bg-red-100 cursor-pointer" @click="activeTab.error = null">
                <Icon name="x" :size="12" />
            </button>
        </div>

        <div ref="host" class="flex-1 min-h-0" />
    </section>
</template>
