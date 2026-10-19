<script setup lang="ts">
import { ChevronRight, FileText } from '@lucide/vue'
import { computed, ref, useId } from 'vue'
import type { GitFileChange } from '@/queries/gitQuery'
import { statusBadge, type ChangeRow } from './sourceControl'

const props = withDefaults(defineProps<{
    title: string
    rows: ChangeRow[]
    committed?: boolean
    disabled: boolean
    canOpenFile: boolean
    /** Rows that are other worktrees nested in this checkout, by path, with the worktree's label. */
    worktreeLabels?: Record<string, string>
}>(), { committed: false, worktreeLabels: () => ({}) })
const emit = defineEmits<{
    toggle: [paths: string[] | 'all', stage: boolean]
    open: [row: ChangeRow]
    openFile: [file: GitFileChange]
}>()

const expanded = ref(true)
const sectionId = useId()

const stagedCount = computed(() => props.rows.filter(row => row.state !== 'unstaged').length)
const allStaged = computed(() => props.rows.length > 0 && props.rows.every(row => row.state === 'staged'))
const someStaged = computed(() => !allStaged.value && stagedCount.value > 0)

const stageLabel = (row: ChangeRow) => (row.state === 'staged' ? 'Unstage' : 'Stage')

const checkbox = 'shrink-0 w-4 h-4 accent-zinc-900 cursor-pointer disabled:cursor-default'
const iconButton = 'p-0.5 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200 cursor-pointer disabled:cursor-default disabled:text-zinc-300'
</script>

<template>
    <section class="pb-2" :data-testid="committed ? 'committed-changes' : 'changes'">
        <div class="flex items-center gap-2.5 h-9 px-3">
            <input
                v-if="!committed"
                type="checkbox"
                :class="checkbox"
                :checked="allStaged"
                :indeterminate="someStaged"
                :disabled="disabled"
                :aria-label="allStaged ? 'Unstage all' : 'Stage all'"
                :title="allStaged ? 'Unstage all' : 'Stage all'"
                @click.prevent="emit('toggle', 'all', !allStaged)"
            >
            <button
                type="button"
                :aria-expanded="expanded"
                :aria-controls="sectionId"
                class="flex-1 min-w-0 flex items-center gap-1 text-left text-ui-11 font-semibold uppercase tracking-[0.08em] text-zinc-500 cursor-pointer"
                @click="expanded = !expanded"
            >
                <span class="truncate">{{ title }}</span>
                <ChevronRight :size="11" class="shrink-0 text-zinc-400 transition-transform" :class="expanded && 'rotate-90'" />
            </button>
            <span v-if="!committed" data-testid="staged-count" class="shrink-0 text-ui-12 text-zinc-500">
                {{ stagedCount }} of {{ rows.length }} staged
            </span>
            <span v-else data-testid="committed-count" class="shrink-0 text-ui-12 tabular-nums text-zinc-500">{{ rows.length }}</span>
        </div>

        <div v-if="$slots.description" class="px-3 pb-1.5 -mt-1 text-ui-12 text-zinc-500 break-words">
            <slot name="description" />
        </div>

        <ul v-show="expanded" :id="sectionId" class="text-ui-12.5">
            <li
                v-for="row in rows"
                :key="row.file.path"
                class="group flex items-center gap-2.5 h-8 px-3 min-w-0 hover:bg-zinc-100"
                :data-state="row.state"
                :title="row.file.original_path ? `${row.file.original_path} → ${row.file.path}` : row.file.path"
            >
                <input
                    v-if="!committed"
                    type="checkbox"
                    :class="checkbox"
                    :checked="row.state === 'staged'"
                    :indeterminate="row.state === 'partial'"
                    :disabled="disabled"
                    :aria-label="`${stageLabel(row)} ${row.file.path}`"
                    :title="row.state === 'partial' ? 'Partly staged' : stageLabel(row)"
                    @click.prevent="emit('toggle', [row.file.path], row.state !== 'staged')"
                >
                <span
                    class="shrink-0 w-[18px] h-[18px] flex items-center justify-center rounded font-mono text-ui-10.5 font-semibold"
                    :class="statusBadge(row.file).tone"
                    :aria-label="statusBadge(row.file).label"
                >{{ statusBadge(row.file).letter }}</span>

                <button
                    type="button"
                    class="flex-1 min-w-0 flex items-baseline gap-1.5 pr-2 text-left cursor-pointer"
                    :title="worktreeLabels[row.file.path] ? `Switch to worktree ${worktreeLabels[row.file.path]}` : `Show changes in ${row.file.path}`"
                    @click="emit('open', row)"
                >
                    <span
                        class="shrink-0 max-w-full truncate text-zinc-900"
                        :class="row.file.status === 'D' && 'line-through text-zinc-500'"
                    >{{ worktreeLabels[row.file.path] ?? row.file.name }}</span>
                    <span class="min-w-0 truncate text-ui-11.5 text-zinc-400">{{ row.file.dir }}</span>
                </button>

                <button
                    v-if="canOpenFile && row.file.status !== 'D' && !worktreeLabels[row.file.path]"
                    type="button"
                    :class="[iconButton, 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100']"
                    title="Open file"
                    :aria-label="`Open ${row.file.path}`"
                    @click="emit('openFile', row.file)"
                >
                    <FileText :size="12" />
                </button>

                <span class="shrink-0 text-ui-11.5 tabular-nums" data-testid="line-stats">
                    <span v-if="worktreeLabels[row.file.path]" class="text-zinc-500">worktree</span>
                    <span v-else-if="row.file.untracked && !row.file.additions" class="text-emerald-600">untracked</span>
                    <span v-else-if="row.file.binary" class="text-zinc-400">binary</span>
                    <template v-else>
                        <span v-if="row.file.additions" class="text-emerald-600">+{{ row.file.additions }}</span>
                        <span v-if="row.file.deletions" class="ml-1.5 text-red-500">-{{ row.file.deletions }}</span>
                    </template>
                </span>
            </li>
        </ul>
    </section>
</template>
