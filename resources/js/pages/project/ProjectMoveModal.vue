<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import useProjects from '@/queries/projectsQuery'
import useWorkspaces from '@/queries/workspacesQuery'
import type { Project } from '@/types/type'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ openChange: [open: boolean] }>()
defineSlots<{ trigger(): unknown }>()

const { workspaces } = useWorkspaces()
const { handleMoveProject } = useProjects()

const loading = ref(false)
const error = ref('')

function onOpenChange(open: boolean) {
    if (open) {
        loading.value = false
        error.value = ''
    }
    emit('openChange', open)
}

async function select(workspaceId: number | null, close: () => void) {
    if (workspaceId === props.project.workspace_id) { close(); return }
    loading.value = true
    error.value = ''
    try {
        await handleMoveProject(props.project, workspaceId)
        close()
    } catch {
        error.value = 'Failed to move project'
        loading.value = false
    }
}

const optionClass = (selected: boolean) => [
    'text-left py-2 px-3 rounded bg-transparent border text-[13px] flex items-center gap-2',
    selected ? 'border-accent text-accent' : 'border-stroke text-zinc-700',
    loading.value ? 'cursor-default' : 'cursor-pointer',
]
</script>

<template>
    <Modal aria-label="Move project" @open-change="onOpenChange">
        <template #trigger>
            <slot name="trigger" />
        </template>

        <template #default="{ close }">
            <h2 class="m-0 text-zinc-900 text-[14px] font-semibold">
                Move
                <span class="font-mono text-accent">{{ props.project.name }}</span>
            </h2>
            <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
            <div class="flex flex-col gap-1.5">
                <button
                    type="button"
                    :disabled="loading"
                    :class="optionClass(props.project.workspace_id === null)"
                    @click="select(null, close)"
                >
                    <span class="text-zinc-400">—</span> Unassigned
                    <span v-if="props.project.workspace_id === null" class="ml-auto text-zinc-400 text-[11px]">current</span>
                </button>
                <button
                    v-for="w in workspaces"
                    :key="w.id"
                    type="button"
                    :disabled="loading"
                    :class="optionClass(w.id === props.project.workspace_id)"
                    @click="select(w.id, close)"
                >
                    {{ w.name }}
                    <span v-if="w.id === props.project.workspace_id" class="ml-auto text-zinc-400 text-[11px]">current</span>
                </button>
            </div>
            <div class="flex justify-end">
                <button
                    type="button"
                    :disabled="loading"
                    class="bg-transparent border border-stroke rounded text-zinc-700 text-[12px] py-1.5 px-3.5 cursor-pointer"
                    @click="close"
                >
                    Cancel
                </button>
            </div>
        </template>
    </Modal>
</template>
