<script setup lang="ts">
import Modal from '@/components/ui/Modal.vue'
import useProjects from '@/queries/projectsQuery'
import type { Project } from '@/types/type'

// Delegates to useProjects' handleProjectDeleted so the project's terminal
// sessions are torn down and the sidebar's projects query is invalidated.

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ openChange: [open: boolean] }>()
defineSlots<{ trigger(): unknown }>()

const { handleProjectDeleted, deleting } = useProjects()

async function confirmDelete(close: () => void) {
    try {
        await handleProjectDeleted(props.project.id)
        close()
    } catch {
        // Keep the modal open so the user can retry.
    }
}
</script>

<template>
    <Modal aria-label="Delete project" @open-change="emit('openChange', $event)">
        <template #trigger>
            <slot name="trigger" />
        </template>

        <template #default="{ close }">
            <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">Delete Project</h2>
            <p class="m-0 text-zinc-700 text-[13px] leading-normal">
                Remove
                <span class="text-zinc-900 font-mono text-[12px]">{{ props.project.name }}</span>
                from Keera? This only removes it from the app — files on disk are not deleted.
            </p>
            <div class="flex gap-2 justify-end">
                <button
                    type="button"
                    class="bg-transparent border border-stroke rounded text-zinc-700 text-[12px] py-1.5 px-3.5 cursor-pointer"
                    @click="close"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    :disabled="deleting"
                    :class="[
                        'bg-[#da3633] border border-danger rounded text-white text-[12px] py-1.5 px-3.5',
                        deleting ? 'cursor-default opacity-70' : 'cursor-pointer opacity-100',
                    ]"
                    @click="confirmDelete(close)"
                >
                    {{ deleting ? 'Deleting…' : 'Delete' }}
                </button>
            </div>
        </template>
    </Modal>
</template>
