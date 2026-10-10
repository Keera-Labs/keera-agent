<script setup lang="ts">
import { ChevronsUp, File, Folder, Funnel, RefreshCw, Search } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useEditorSettingsStore } from '@/stores/editorSettingsStore'
import { useEditorStore } from '@/stores/editorStore'
import type { Project } from '@/types/type'
import { isIgnored, useFileTree, type FileEntry } from './useFileTree'

const props = defineProps<{ project: Project }>()

const editor = useEditorStore()
const { openError, activeTab } = storeToRefs(editor)
const tree = useFileTree(() => props.project.id)
const { rootError } = tree
const query = ref('')
const selectedPath = ref<string | null>(null)

const rows = computed(() => tree.visibleRows(query.value))
const projectOpenError = computed(() => openError.value?.projectId === props.project.id ? openError.value : null)

// The backend applies the filters, so a saved change needs fresh listings.
const settings = useEditorSettingsStore()
const { fileFilters } = storeToRefs(settings)
const hidingFiles = computed(() => fileFilters.value.hide_hidden && fileFilters.value.hide_ignored)
watch(() => JSON.stringify(fileFilters.value), () => void tree.refresh())

function toggleHiding() {
    const hide = !hidingFiles.value
    void settings.setFileFilters({ hide_hidden: hide, hide_ignored: hide })
}

onMounted(tree.refresh)

const treeList = ref<HTMLElement | null>(null)

function revealSelectedRow() {
    const list = treeList.value
    const row = [...list?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []].find(el => el.dataset.path === selectedPath.value)
    if (!list || !row) return
    const bounds = list.getBoundingClientRect()
    const box = row.getBoundingClientRect()
    if (box.top < bounds.top || box.bottom > bounds.bottom) row.scrollIntoView({ block: 'start' })
}

watch(
    () => activeTab.value?.projectId === props.project.id ? activeTab.value.path : null,
    async path => {
        if (path === null) return
        selectedPath.value = path
        await tree.reveal(path)
        await nextTick()
        if (selectedPath.value === path) revealSelectedRow()
    },
    { immediate: true, flush: 'post' },
)

function onEntryClick(entry: FileEntry) {
    selectedPath.value = entry.path
    if (entry.type === 'file') editor.open(props.project.id, entry.path)
    else tree.toggle(entry)
}

function openFirstMatch() {
    const match = rows.value.find(row => row.kind === 'entry' && row.entry.type === 'file')
    if (match?.kind === 'entry') onEntryClick(match.entry)
}

const indent = (depth: number) => ({ paddingLeft: `${8 + depth * 16}px` })

const iconButton = 'shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 cursor-pointer hover:text-zinc-800 hover:bg-black/[0.05] transition-colors'
</script>

<template>
    <div class="flex-1 min-h-0 flex flex-col min-w-0 text-ui-13 text-zinc-800" :title="project.path">
        <div class="flex items-center gap-1 px-3 pt-3 pb-2 shrink-0">
            <label class="flex-1 min-w-0 flex items-center gap-2 h-8 px-2.5 rounded-lg border border-stroke bg-surface focus-within:border-zinc-400">
                <Search :size="13" class="shrink-0 text-zinc-400" />
                <input
                    v-model="query"
                    type="text"
                    placeholder="Go to file…"
                    aria-label="Go to file"
                    class="flex-1 min-w-0 bg-transparent outline-none placeholder:text-zinc-400"
                    @keydown.enter.prevent="openFirstMatch"
                >
            </label>
            <button
                type="button"
                :class="[iconButton, hidingFiles && 'text-accent! bg-black/[0.05]']"
                :title="hidingFiles ? 'Show hidden and ignored files' : 'Hide hidden and ignored files'"
                :aria-pressed="hidingFiles"
                @click="toggleHiding"
            >
                <Funnel :size="14" />
            </button>
            <button type="button" :class="iconButton" title="Refresh" @click="tree.refresh">
                <RefreshCw :size="14" />
            </button>
            <button type="button" data-testid="collapse-all" :class="iconButton" title="Collapse all" @click="tree.collapseAll">
                <ChevronsUp :size="15" />
            </button>
        </div>

        <div
            v-if="projectOpenError"
            role="alert"
            data-testid="file-open-error"
            class="flex items-start gap-1.5 mx-3 mb-2 px-2 py-1.5 shrink-0 rounded-md bg-red-50 text-ui-12 text-danger"
        >
            <span class="flex-1 min-w-0 break-words">
                Can't open {{ projectOpenError.path.split('/').pop() }}: {{ projectOpenError.message }}
            </span>
            <button type="button" aria-label="Dismiss" class="p-0.5 rounded hover:bg-red-100 cursor-pointer" @click="openError = null">
                <Icon name="x" :size="11" />
            </button>
        </div>

        <div ref="treeList" class="flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2" role="tree" :aria-label="`${project.name} files`">
            <p v-if="tree.isLoadingRoot()" class="px-3 py-2 text-zinc-400">Loading…</p>
            <p v-else-if="rootError" class="px-3 py-2 text-danger">{{ rootError }}</p>
            <p v-else-if="rows.length === 0" class="px-3 py-2 text-zinc-400">
                {{ query ? 'No matching files' : 'No files' }}
            </p>
            <template v-for="row in rows" :key="row.kind === 'entry' ? row.entry.path : row.key">
                <p
                    v-if="row.kind === 'notice'"
                    :style="indent(row.depth)"
                    class="h-7 flex items-center gap-1.5 pr-2 text-ui-12"
                    :class="row.tone === 'error' ? 'text-danger' : 'text-zinc-400 italic'"
                >
                    <span class="w-3.5 shrink-0" /><span class="truncate">{{ row.text }}</span>
                </p>
                <button
                    v-else
                    type="button"
                    role="treeitem"
                    :aria-expanded="row.entry.type === 'dir' ? row.expanded : undefined"
                    :aria-selected="row.entry.path === selectedPath"
                    :data-path="row.entry.path"
                    :title="row.entry.path"
                    :style="indent(row.depth)"
                    class="flex items-center gap-1.5 w-full h-7 pr-2 rounded-md text-left cursor-pointer hover:bg-black/[0.04]"
                    :class="[
                        row.entry.path === selectedPath && 'bg-amber-100/80! font-semibold text-zinc-950',
                        isIgnored(row.entry.name) && 'text-zinc-400',
                    ]"
                    @click="onEntryClick(row.entry)"
                >
                    <span class="w-3.5 shrink-0 flex justify-center text-zinc-500">
                        <Icon
                            v-if="row.entry.type === 'dir'"
                            name="chevron-right"
                            :size="12"
                            class="transition-transform"
                            :class="[row.expanded && 'rotate-90', row.loading && 'animate-pulse']"
                        />
                    </span>
                    <Folder v-if="row.entry.type === 'dir'" :size="14" class="shrink-0 fill-amber-300 text-amber-500" />
                    <File v-else :size="14" class="shrink-0 text-zinc-500" />
                    <span class="flex-1 min-w-0 truncate">{{ row.entry.name }}</span>
                    <span v-if="isIgnored(row.entry.name)" class="w-1.5 h-1.5 shrink-0 rounded-full bg-zinc-300" aria-label="ignored" />
                </button>
            </template>
        </div>
    </div>
</template>
