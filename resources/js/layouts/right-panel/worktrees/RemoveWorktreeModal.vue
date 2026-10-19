<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { cancelBtnClass } from '@/components/ui/styles'
import { worktreeLabel } from '@/composables/useGitWorktree'
import { useRemoveGitWorktree, type GitWorktree } from '@/queries/gitQuery'

const props = defineProps<{ projectId: number; worktree: GitWorktree; changedFiles: number }>()
const emit = defineEmits<{ close: [] }>()

const removal = useRemoveGitWorktree(() => props.projectId)

async function remove() {
    try {
        await removal.mutateAsync({ path: props.worktree.path, force: props.changedFiles > 0 })
        emit('close')
    } catch {}
}

const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && emit('close')
onMounted(() => window.addEventListener('keydown', closeOnEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', closeOnEscape))
</script>

<template>
    <Teleport to="body">
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" @click.self="emit('close')">
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Remove worktree"
                data-testid="remove-worktree-dialog"
                class="bg-modal border border-stroke rounded-md p-6 w-[360px] flex flex-col gap-3.5"
            >
                <h2 class="m-0 text-zinc-900 text-ui-15 font-semibold">Remove worktree</h2>
                <p class="m-0 text-zinc-500 text-ui-13 leading-normal">
                    Remove
                    <span class="text-zinc-700 font-medium">{{ worktreeLabel(worktree) }}</span>
                    at <span class="text-zinc-700 font-mono text-ui-12 break-all">{{ worktree.path }}</span>?
                    The branch <span class="text-zinc-700 font-mono text-ui-12">{{ worktree.branch ?? 'detached' }}</span> is kept.
                </p>
                <p
                    v-if="changedFiles"
                    data-testid="remove-worktree-warning"
                    class="m-0 px-2.5 py-2 rounded bg-red-50 text-danger text-ui-12 leading-normal"
                >
                    {{ changedFiles }} uncommitted {{ changedFiles === 1 ? 'file' : 'files' }} will be permanently lost.
                </p>
                <span v-if="removal.error.value" role="alert" class="text-danger text-ui-12">{{ removal.error.value.message }}</span>
                <div class="flex gap-2 justify-end">
                    <button type="button" :disabled="removal.isLoading.value" :class="cancelBtnClass" @click="emit('close')">Cancel</button>
                    <button
                        type="button"
                        data-testid="confirm-remove-worktree"
                        :disabled="removal.isLoading.value"
                        class="bg-[#da3633] border border-danger rounded text-white text-ui-12 py-1.5 px-3.5 cursor-pointer"
                        @click="remove"
                    >
                        {{ removal.isLoading.value ? 'Removing…' : 'Remove' }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>
