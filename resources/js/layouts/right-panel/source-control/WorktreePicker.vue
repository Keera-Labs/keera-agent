<script setup lang="ts">
import { Check, ChevronDown, FolderGit2 } from '@lucide/vue'
import { worktreeLabel } from '@/composables/useGitWorktree'
import type { GitWorktree } from '@/queries/gitQuery'
import PanelMenu from './PanelMenu.vue'
import { menuItemClass } from './sourceControl'

defineProps<{ worktrees: GitWorktree[]; selected: GitWorktree | null; branchLabel: string; title?: string }>()
const emit = defineEmits<{ select: [path: string] }>()

const branchOf = (worktree: GitWorktree) =>
    worktree.branch ?? (worktree.head ? `detached @ ${worktree.head.slice(0, 7)}` : 'no commits')
</script>

<template>
    <PanelMenu label="Worktrees" full-width menu-class="max-h-80 overflow-y-auto">
        <template #trigger="{ toggle }">
            <button
                type="button"
                data-testid="branch-pill"
                class="min-w-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-200/70 font-mono text-[11px] text-zinc-700 hover:bg-zinc-200 cursor-pointer"
                :title="selected ? `${title ?? branchLabel}\n${selected.path}` : title"
                aria-label="Switch worktree"
                @click="toggle"
            >
                <FolderGit2 v-if="selected && !selected.is_current" :size="11" class="shrink-0 text-accent" />
                <span v-if="selected && !selected.is_current" class="shrink-0 max-w-20 truncate font-sans" data-testid="worktree-label">
                    {{ worktreeLabel(selected) }}
                </span>
                <span class="min-w-0 truncate">{{ branchLabel }}</span>
                <ChevronDown :size="11" class="shrink-0 text-zinc-500" />
            </button>
        </template>
        <template #default="{ close }">
            <p class="px-3 pt-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-400">Worktrees</p>
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
                    <span class="block truncate text-[11px] text-zinc-400">
                        {{ worktreeLabel(worktree) }}<template v-if="worktree.locked"> · locked</template>
                    </span>
                </span>
            </button>
        </template>
    </PanelMenu>
</template>
