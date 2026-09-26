<script setup lang="ts">
import { ChevronRight, CircleCheck, FileText, Minus, Plus } from '@lucide/vue'
import { ref, useId } from 'vue'
import type { GitFileChange } from '@/queries/gitQuery'
import { statusBadge } from './sourceControl'

const props = withDefaults(defineProps<{
    title: string
    files: GitFileChange[]
    staged: boolean
    disabled: boolean
    canOpenFile: boolean
    /** Rows that are other worktrees nested in this checkout, by path, with the worktree's label. */
    worktreeLabels?: Record<string, string>
}>(), { worktreeLabels: () => ({}) })
const emit = defineEmits<{ toggle: [paths: string[] | 'all']; open: [file: GitFileChange]; openFile: [file: GitFileChange] }>()

const expanded = ref(true)
const sectionId = useId()
const actionLabel = props.staged ? 'Unstage' : 'Stage'

const iconButton = 'p-0.5 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200 cursor-pointer disabled:cursor-default disabled:text-zinc-300'
</script>

<template>
    <section class="pb-2" :data-testid="staged ? 'staged-changes' : 'changes'">
        <div class="group flex items-center gap-1 h-7 pl-2 pr-3">
            <button
                type="button"
                :aria-expanded="expanded"
                :aria-controls="sectionId"
                class="flex-1 min-w-0 flex items-center gap-1 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500 cursor-pointer"
                @click="expanded = !expanded"
            >
                <ChevronRight :size="11" class="shrink-0 transition-transform" :class="expanded && 'rotate-90'" />
                <span class="truncate">{{ title }}</span>
            </button>
            <button
                type="button"
                :class="[iconButton, 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100']"
                :title="`${actionLabel} all`"
                :aria-label="`${actionLabel} all`"
                :disabled="disabled"
                @click="emit('toggle', 'all')"
            >
                <component :is="staged ? Minus : Plus" :size="12" />
            </button>
            <span class="min-w-5 h-5 px-1.5 flex items-center justify-center rounded bg-zinc-200/80 text-[11px] font-semibold text-zinc-600">
                {{ files.length }}
            </span>
        </div>

        <ul v-show="expanded" :id="sectionId" class="font-mono text-[12px]">
            <li
                v-for="file in files"
                :key="file.path"
                class="group flex items-center gap-2 h-[26px] pl-5 pr-3 hover:bg-zinc-200/50"
                :title="file.original_path ? `${file.original_path} → ${file.path}` : file.path"
            >
                <CircleCheck v-if="staged" :size="14" class="shrink-0 text-emerald-600" :aria-label="`Staged, ${statusBadge(file).label.toLowerCase()}`" />
                <span
                    v-else
                    class="w-3.5 shrink-0 text-center font-semibold"
                    :class="statusBadge(file).tone"
                    :aria-label="statusBadge(file).label"
                >{{ statusBadge(file).letter }}</span>

                <button
                    type="button"
                    class="flex-1 min-w-0 flex items-baseline gap-1.5 text-left cursor-pointer"
                    :title="worktreeLabels[file.path] ? `Switch to worktree ${worktreeLabels[file.path]}` : `Show changes in ${file.path}`"
                    @click="emit('open', file)"
                >
                    <span
                        class="shrink-0 max-w-full truncate text-zinc-900"
                        :class="[staged && 'font-semibold', file.status === 'D' && 'line-through text-zinc-500']"
                    >{{ worktreeLabels[file.path] ?? file.name }}</span>
                    <span class="min-w-0 truncate text-zinc-400 text-[11px]">{{ file.dir }}</span>
                </button>

                <button
                    v-if="canOpenFile && file.status !== 'D' && !worktreeLabels[file.path]"
                    type="button"
                    :class="[iconButton, 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100']"
                    title="Open file"
                    :aria-label="`Open ${file.path}`"
                    @click="emit('openFile', file)"
                >
                    <FileText :size="12" />
                </button>
                <button
                    type="button"
                    :class="[iconButton, 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100']"
                    :title="actionLabel"
                    :aria-label="`${actionLabel} ${file.path}`"
                    :disabled="disabled"
                    @click="emit('toggle', [file.path])"
                >
                    <component :is="staged ? Minus : Plus" :size="12" />
                </button>

                <span class="shrink-0 text-[11px] tabular-nums" data-testid="line-stats">
                    <span v-if="worktreeLabels[file.path]" class="text-zinc-500">worktree</span>
                    <span v-else-if="file.untracked" class="text-emerald-600">untracked</span>
                    <span v-else-if="file.binary" class="text-zinc-400">binary</span>
                    <template v-else>
                        <span class="text-emerald-600">+{{ file.additions ?? 0 }}</span>
                        <span class="ml-1 text-red-500">-{{ file.deletions ?? 0 }}</span>
                    </template>
                </span>
            </li>
        </ul>
    </section>
</template>
