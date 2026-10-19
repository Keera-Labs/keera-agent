<script setup lang="ts">
import { Check, ChevronDown, GitBranch } from '@lucide/vue'
import { worktreeLabel } from '@/composables/useGitWorktree'
import type { GitWorktree } from '@/queries/gitQuery'
import PanelMenu from './PanelMenu.vue'
import { menuItemClass } from './sourceControl'

withDefaults(
    defineProps<{ worktrees: GitWorktree[]; selected: GitWorktree | null; branchLabel: string; title?: string; changes?: Record<string, number> }>(),
    { title: undefined, changes: () => ({}) },
)
const emit = defineEmits<{ select: [path: string] }>()

const changedFiles = (count: number) => `${count} uncommitted ${count === 1 ? 'file' : 'files'}`

const branchOf = (worktree: GitWorktree) =>
    worktree.branch ?? (worktree.head ? `detached @ ${worktree.head.slice(0, 7)}` : 'no commits')
</script>

<template>
    <PanelMenu label="Worktrees" full-width menu-class="max-h-80 overflow-y-auto">
        <template #trigger="{ toggle }">
            <button
                type="button"
                data-testid="branch-pill"
                class="min-w-0 flex items-center gap-2 h-7 rounded-md text-ui-12 text-zinc-700 hover:text-zinc-950 cursor-pointer"
                :title="selected ? `${title ?? branchLabel}\n${selected.path}` : title"
                aria-label="Switch worktree"
                @click="toggle"
            >
                <span
                    v-if="selected && !selected.is_current"
                    class="shrink-0 max-w-28 flex items-center gap-1.5 h-7 px-2 rounded-md bg-amber-100 font-medium text-amber-900"
                >
                    <span class="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span class="min-w-0 truncate" data-testid="worktree-label">{{ worktreeLabel(selected) }}</span>
                </span>
                <GitBranch :size="13" class="shrink-0 text-zinc-500" />
                <span class="min-w-0 truncate font-mono">{{ branchLabel }}</span>
                <ChevronDown :size="11" class="shrink-0 text-zinc-400" />
            </button>
        </template>
        <template #default="{ close }">
            <p class="px-3 pt-1 pb-1.5 text-ui-11 font-medium uppercase tracking-[0.06em] text-zinc-400">Worktrees</p>
            <button
                v-for="worktree in worktrees"
                :key="worktree.path"
                type="button"
                role="menuitemradio"
                data-testid="worktree-option"
                :aria-checked="worktree.path === selected?.path"
                :class="[menuItemClass, 'h-auto py-1.5 items-start']"
                :title="worktree.path"
                @click="close(); emit('select', worktree.path)"
            >
                <Check :size="12" :class="['shrink-0 mt-0.5', worktree.path === selected?.path ? 'text-accent' : 'invisible']" />
                <span class="min-w-0 flex-1">
                    <span class="block truncate font-mono text-zinc-800">{{ branchOf(worktree) }}</span>
                    <span class="block truncate text-ui-11 text-zinc-400">
                        {{ worktreeLabel(worktree) }}<template v-if="worktree.locked"> · locked</template>
                    </span>
                </span>
                <span
                    v-if="changes[worktree.path]"
                    data-testid="worktree-changes"
                    class="shrink-0 mt-0.5 px-1.5 rounded-full bg-zinc-200/70 font-mono text-ui-11 text-zinc-600"
                    :title="changedFiles(changes[worktree.path]!)"
                >
                    {{ changes[worktree.path] }}
                </span>
            </button>
        </template>
    </PanelMenu>
</template>
