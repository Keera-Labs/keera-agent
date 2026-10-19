<script setup lang="ts">
import { ChevronRight, FolderGit2, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useGitBase } from '@/composables/useGitBase'
import { useGitWorktree, worktreeLabel } from '@/composables/useGitWorktree'
import { useGitBranchChanges, useGitStatus, useGitWorktreeChanges, type GitWorktree } from '@/queries/gitQuery'
import type { Project } from '@/types/type'
import BasePicker from '../source-control/BasePicker.vue'
import WorktreePicker from '../source-control/WorktreePicker.vue'
import RemoveWorktreeModal from './RemoveWorktreeModal.vue'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ open: [] }>()
const projectId = () => props.project.id

const { worktrees, selected, target, select } = useGitWorktree(projectId)
const { status } = useGitStatus(target)
const isRepo = computed(() => status.value?.is_repo === true)
const hasCommits = computed(() => isRepo.value && status.value?.has_commits === true)
const comparisonBase = useGitBase(projectId, target, hasCommits)
const branchQuery = useGitBranchChanges(target, comparisonBase.base, () => isRepo.value && comparisonBase.ready.value)
const changesQuery = useGitWorktreeChanges(projectId)
const changes = computed(() => changesQuery.data.value ?? {})

const branchLabel = computed(() => {
    if (!status.value) return ''
    return status.value.detached ? `detached @ ${status.value.head?.slice(0, 7)}` : status.value.branch ?? 'no branch'
})

const isDirty = (worktree: GitWorktree) => (changes.value[worktree.path] ?? 0) > 0
const others = computed(() => {
    const rest = worktrees.value.filter(w => w.path !== selected.value?.path)
    return [...rest.filter(isDirty), ...rest.filter(w => !isDirty(w))]
})

const branchOf = (worktree: GitWorktree) => worktree.branch ?? 'detached'
const fileCount = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`

const removing = ref<GitWorktree | null>(null)

function open(worktree: GitWorktree) {
    select(worktree.path)
    emit('open')
}
</script>

<template>
    <div class="flex-1 min-h-0 flex flex-col min-w-0 text-ui-12 text-zinc-700" data-testid="worktrees-view">
        <div class="flex items-center gap-2 h-12 px-3 shrink-0 border-b border-stroke">
            <WorktreePicker
                v-if="isRepo"
                class="min-w-0 flex-1"
                :worktrees="worktrees"
                :selected="selected"
                :branch-label="branchLabel"
                :changes="changes"
                @select="select"
            />
            <span v-else class="flex-1" />
            <BasePicker
                v-if="hasCommits && branchQuery.data.value"
                class="min-w-0 shrink-0"
                :branches="comparisonBase.branches.value"
                :current="branchQuery.data.value.base"
                :default-base="comparisonBase.defaultBase.value"
                @select="comparisonBase.select"
            />
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3">
            <button
                v-if="selected"
                type="button"
                data-testid="current-worktree"
                class="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-amber-200 bg-amber-50 text-left cursor-pointer hover:bg-amber-100/70"
                :title="selected.path"
                @click="open(selected)"
            >
                <FolderGit2 :size="15" class="shrink-0 text-amber-700" />
                <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-2 min-w-0">
                        <span class="min-w-0 truncate text-ui-14 font-semibold text-zinc-900">{{ worktreeLabel(selected) }}</span>
                        <span class="shrink-0 px-1.5 py-px rounded bg-amber-200 text-ui-10 font-semibold tracking-[0.06em] text-amber-900">CURRENT</span>
                    </span>
                    <span class="block truncate font-mono text-ui-12 text-zinc-500">{{ branchOf(selected) }}</span>
                </span>
                <span
                    v-if="changes[selected.path] !== undefined"
                    :class="['shrink-0 text-ui-12', isDirty(selected) ? 'text-orange-700' : 'text-zinc-500']"
                >
                    {{ isDirty(selected) ? fileCount(changes[selected.path]!) : 'No changes' }}
                </span>
            </button>

            <div class="flex items-center justify-between px-1 pt-5 pb-1.5 text-ui-11 font-medium uppercase tracking-[0.06em] text-zinc-500">
                <span>All worktrees</span>
                <span data-testid="worktree-total" class="tabular-nums">{{ worktrees.length }}</span>
            </div>

            <ul>
                <li
                    v-for="worktree in others"
                    :key="worktree.path"
                    data-testid="worktree-row"
                    class="group flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-zinc-100"
                    :title="worktree.path"
                >
                    <FolderGit2 :size="15" class="shrink-0 text-zinc-500" />
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-ui-14 text-zinc-900">{{ worktreeLabel(worktree) }}</span>
                        <span class="block truncate font-mono text-ui-12 text-zinc-500">{{ branchOf(worktree) }}</span>
                    </span>
                    <span
                        v-if="changes[worktree.path] !== undefined"
                        data-testid="worktree-changes"
                        :class="['shrink-0 text-ui-12', isDirty(worktree) ? 'text-orange-700' : 'text-zinc-500']"
                    >
                        {{ isDirty(worktree) ? fileCount(changes[worktree.path]!) : 'No changes' }}
                    </span>
                    <button
                        type="button"
                        data-testid="remove-worktree"
                        :disabled="worktree.is_main"
                        :class="['shrink-0 p-1 rounded text-zinc-500 hover:text-danger hover:bg-zinc-200/70 cursor-pointer', worktree.is_main && 'invisible']"
                        :aria-label="`Remove worktree ${worktreeLabel(worktree)}`"
                        title="Remove worktree"
                        @click="removing = worktree"
                    >
                        <Trash2 :size="14" />
                    </button>
                    <button
                        type="button"
                        data-testid="open-worktree"
                        class="shrink-0 p-1 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200/70 cursor-pointer"
                        :aria-label="`Show changes in ${worktreeLabel(worktree)}`"
                        title="Show changes"
                        @click="open(worktree)"
                    >
                        <ChevronRight :size="14" />
                    </button>
                </li>
            </ul>
        </div>

        <RemoveWorktreeModal
            v-if="removing"
            :project-id="project.id"
            :worktree="removing"
            :changed-files="changes[removing.path] ?? 0"
            @close="removing = null"
        />
    </div>
</template>
