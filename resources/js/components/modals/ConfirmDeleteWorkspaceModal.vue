<script setup lang="ts">
import { ref } from 'vue'
import { cancelBtnClass } from '@/components/ui/styles'
import type { Workspace } from '@/types/type'

const props = defineProps<{ workspace: Workspace }>()
const emit = defineEmits<{ close: []; deleted: [workspaceId: number] }>()

const loading = ref(false)
const error = ref('')

// Fetches directly (not through useWorkspaces' mutation) to surface the server's error message.
async function handleDelete() {
    loading.value = true
    error.value = ''
    try {
        const res = await fetch(`/api/workspaces/${props.workspace.id}`, { method: 'DELETE' })
        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            error.value = data.error ?? 'Failed to delete workspace'
            return
        }
        emit('deleted', props.workspace.id)
        emit('close')
    } catch {
        error.value = 'Network error'
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Delete workspace"
            class="bg-modal border border-stroke rounded-md p-6 w-[340px] flex flex-col gap-3.5"
        >
            <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">Delete Workspace</h2>
            <p class="m-0 text-zinc-500 text-[13px] leading-normal">
                Delete
                <span class="text-zinc-700 font-mono text-[12px]">{{ props.workspace.name }}</span>
                ? Projects in this workspace will become unassigned.
            </p>
            <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
            <div class="flex gap-2 justify-end">
                <button type="button" :disabled="loading" :class="cancelBtnClass" @click="emit('close')">Cancel</button>
                <button
                    type="button"
                    :disabled="loading"
                    class="bg-[#da3633] border border-danger rounded text-white text-[12px] py-1.5 px-3.5 cursor-pointer"
                    @click="handleDelete"
                >
                    {{ loading ? 'Deleting…' : 'Delete' }}
                </button>
            </div>
        </div>
    </div>
</template>
