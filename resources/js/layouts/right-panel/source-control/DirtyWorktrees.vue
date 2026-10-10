<script setup lang="ts">
import { ChevronRight, FolderGit2 } from '@lucide/vue'
import { computed } from 'vue'
import { worktreeLabel } from '@/composables/useGitWorktree'
import type { GitWorktree } from '@/queries/gitQuery'

const LIMIT = 5

const props = defineProps<{ worktrees: GitWorktree[]; changes: Record<string, number> }>()
const emit = defineEmits<{ select: [path: string] }>()

const shown = computed(() => props.worktrees.slice(0, LIMIT))
const hidden = computed(() => props.worktrees.length - shown.value.length)
const changedFiles = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`
</script>

<template>
    <section data-testid="dirty-worktrees" class="px-3 pb-3">
        <p class="px-2 pb-1 text-ui-11 font-medium uppercase tracking-[0.06em] text-zinc-400">Uncommitted in other worktrees</p>
        <ul>
            <li v-for="worktree in shown" :key="worktree.path">
                <button
                    type="button"
                    data-testid="dirty-worktree"
                    class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-zinc-200/50 cursor-pointer"
                    :title="`Show changes in ${worktree.path}`"
                    @click="emit('select', worktree.path)"
                >
                    <FolderGit2 :size="13" class="shrink-0 text-zinc-400" />
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-zinc-800">{{ worktreeLabel(worktree) }}</span>
                        <span class="block truncate font-mono text-ui-11 text-zinc-400">{{ worktree.branch ?? 'detached' }}</span>
                    </span>
                    <span class="shrink-0 text-ui-11 text-zinc-500">{{ changedFiles(changes[worktree.path]!) }}</span>
                    <ChevronRight :size="12" class="shrink-0 text-zinc-400" />
                </button>
            </li>
        </ul>
        <p v-if="hidden" data-testid="dirty-worktrees-more" class="px-2 pt-1 text-zinc-400">
            {{ hidden }} more in the worktree menu above.
        </p>
    </section>
</template>
