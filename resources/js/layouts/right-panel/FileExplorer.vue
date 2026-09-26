<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useEditorStore } from '@/stores/editorStore'
import type { Project } from '@/types/type'
import { isIgnored, isMuted, useFileTree, type FileEntry } from './useFileTree'

const props = defineProps<{ project: Project }>()

const editor = useEditorStore()
const { openError } = storeToRefs(editor)
const tree = useFileTree(() => props.project.id)
const { rootError } = tree
const query = ref('')
const hideIgnored = ref(false)
const selectedPath = ref<string | null>(null)

const rows = computed(() => tree.visibleRows(query.value, hideIgnored.value))
const projectOpenError = computed(() => openError.value?.projectId === props.project.id ? openError.value : null)

onMounted(tree.refresh)

function onEntryClick(entry: FileEntry) {
    selectedPath.value = entry.path
    if (entry.type === 'file') editor.open(props.project.id, entry.path)
    else tree.toggle(entry)
}

const indent = (depth: number) => ({ paddingLeft: `${8 + depth * 12}px` })

const iconButton = 'p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/70 transition-colors'
</script>

<template>
    <div class="flex flex-col h-full min-w-0 text-[12px] text-zinc-700">
        <div class="flex items-center gap-1 h-10 pl-3 pr-2 shrink-0">
            <span class="flex-1 truncate text-[13px] font-medium text-zinc-900" :title="project.path">{{ project.name }}</span>
            <button
                type="button"
                :class="[iconButton, hideIgnored && 'text-accent! bg-zinc-200/70']"
                :title="hideIgnored ? 'Show hidden and ignored files' : 'Hide hidden and ignored files'"
                :aria-pressed="hideIgnored"
                @click="hideIgnored = !hideIgnored"
            >
                <Icon name="funnel" :size="13" />
            </button>
            <button type="button" :class="iconButton" title="Refresh" @click="tree.refresh">
                <Icon name="refresh-cw" :size="13" />
            </button>
            <button type="button" :class="iconButton" title="More actions" disabled class="disabled:cursor-default">
                <Icon name="ellipsis" :size="13" />
            </button>
        </div>

        <div class="px-2 pb-2 shrink-0 space-y-2">
            <label class="flex items-center gap-1.5 h-7 px-2 rounded-md bg-zinc-200/50 border border-transparent focus-within:border-stroke focus-within:bg-white">
                <Icon name="search" :size="12" class="text-zinc-400 shrink-0" />
                <input
                    v-model="query"
                    type="text"
                    placeholder="Find files"
                    aria-label="Find files"
                    class="flex-1 min-w-0 bg-transparent outline-none placeholder:text-zinc-400"
                >
            </label>
            <div class="grid grid-cols-2 p-0.5 rounded-md bg-zinc-200/50" role="group" aria-label="Search mode">
                <button type="button" class="h-6 rounded bg-white shadow-sm text-zinc-800" aria-pressed="true">Names</button>
                <button type="button" class="h-6 rounded text-zinc-400 cursor-default" disabled title="Content search is coming soon">
                    Contents
                </button>
            </div>
        </div>

        <div
            v-if="projectOpenError"
            role="alert"
            data-testid="file-open-error"
            class="flex items-start gap-1.5 mx-2 mb-2 px-2 py-1.5 shrink-0 rounded-md bg-red-50 text-danger"
        >
            <span class="flex-1 min-w-0 break-words">
                Can't open {{ projectOpenError.path.split('/').pop() }}: {{ projectOpenError.message }}
            </span>
            <button type="button" aria-label="Dismiss" class="p-0.5 rounded hover:bg-red-100 cursor-pointer" @click="openError = null">
                <Icon name="x" :size="11" />
            </button>
        </div>

        <div class="flex-1 overflow-y-auto overflow-x-hidden border-t border-stroke py-1 font-mono" role="tree" :aria-label="`${project.name} files`">
            <p v-if="tree.isLoadingRoot()" class="px-3 py-2 font-sans text-zinc-400">Loading…</p>
            <p v-else-if="rootError" class="px-3 py-2 font-sans text-danger">{{ rootError }}</p>
            <p v-else-if="rows.length === 0" class="px-3 py-2 font-sans text-zinc-400">
                {{ query ? 'No matching files' : 'No files' }}
            </p>
            <template v-for="row in rows" :key="row.kind === 'entry' ? row.entry.path : row.key">
                <p
                    v-if="row.kind === 'notice'"
                    :style="indent(row.depth)"
                    class="h-[22px] flex items-center gap-1 pr-2 font-sans"
                    :class="row.tone === 'error' ? 'text-danger' : 'text-zinc-400 italic'"
                >
                    <span class="w-3 shrink-0" /><span class="truncate">{{ row.text }}</span>
                </p>
                <button
                    v-else
                    type="button"
                    role="treeitem"
                    :aria-expanded="row.entry.type === 'dir' ? row.expanded : undefined"
                    :aria-selected="row.entry.path === selectedPath"
                    :title="row.entry.path"
                    :style="indent(row.depth)"
                    class="flex items-center gap-1 w-full h-[22px] pr-2 text-left hover:bg-zinc-200/50"
                    :class="[
                        row.entry.path === selectedPath && 'bg-zinc-200! font-semibold text-zinc-900',
                        isMuted(row.entry.name) && 'italic text-zinc-400',
                    ]"
                    @click="onEntryClick(row.entry)"
                >
                    <span class="w-3 shrink-0 flex justify-center text-zinc-400">
                        <Icon
                            v-if="row.entry.type === 'dir'"
                            name="chevron-right"
                            :size="11"
                            class="transition-transform"
                            :class="[row.expanded && 'rotate-90', row.loading && 'animate-pulse']"
                        />
                    </span>
                    <Icon v-if="row.entry.type === 'dir'" name="folder" :size="13" fill="currentColor" class="shrink-0 text-zinc-500" />
                    <Icon v-else name="file-text" :size="13" class="shrink-0 text-accent" />
                    <span class="flex-1 truncate">{{ row.entry.name }}</span>
                    <span v-if="isIgnored(row.entry.name)" class="w-1.5 h-1.5 shrink-0 rounded-full bg-zinc-300" aria-label="ignored" />
                </button>
            </template>
        </div>
    </div>
</template>
