<script setup lang="ts">
import { ref } from 'vue'
import ProjectTemplatesModal from '@/components/modals/ProjectTemplatesModal.vue'
import Modal from '@/components/ui/Modal.vue'
import useProjects from '@/queries/projectsQuery'
import type { Project } from '@/types/type'

const inputClass = 'bg-canvas border border-stroke rounded text-zinc-900 text-[13px] py-[7px] px-2.5 outline-none w-full box-border font-mono'
const labelClass = 'text-zinc-700 text-[11px] uppercase tracking-[0.05em]'
const cancelClass = 'bg-transparent border border-stroke rounded text-zinc-700 text-[12px] py-1.5 px-3.5 cursor-pointer'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ openChange: [open: boolean] }>()
defineSlots<{ trigger(): unknown }>()

const { handleProjectUpdated } = useProjects()

const path = ref(props.project.path)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const showTemplates = ref(false)

function onOpenChange(open: boolean) {
    if (open) {
        path.value = props.project.path
        saving.value = false
        saved.value = false
        error.value = ''
        showTemplates.value = false
    }
    emit('openChange', open)
}

async function save(close: () => void) {
    saving.value = true
    error.value = ''
    try {
        const res = await fetch(`/api/projects/${props.project.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path.value.trim() }),
        })
        if (!res.ok) { error.value = 'Something went wrong'; return }
        void handleProjectUpdated(await res.json())
        saved.value = true
        setTimeout(close, 1000)
    } catch {
        error.value = 'Network error'
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <Modal
        aria-label="Edit project"
        panel-class="bg-modal border border-stroke rounded-lg p-6 w-[480px] flex flex-col"
        @open-change="onOpenChange"
    >
        <template #trigger>
            <slot name="trigger" />
        </template>

        <template #default="{ close }">
            <form class="flex flex-col gap-[18px]" @submit.prevent="save(close)">
                <div>
                    <h2 class="m-0 text-zinc-900 text-[15px] font-bold">Edit project</h2>
                    <p class="mt-[3px] mx-0 mb-0 text-accent text-[12px] font-mono">{{ props.project.name }}</p>
                </div>

                <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>

                <label class="flex flex-col gap-1.5">
                    <span :class="labelClass">Path</span>
                    <span class="text-zinc-500 text-[12px] leading-normal">
                        Local filesystem path. Claude Code will run from this directory.
                    </span>
                    <input v-model="path" name="path" placeholder="~/code/my-project" required :class="inputClass">
                </label>

                <div class="flex flex-col gap-2 border-t border-stroke pt-4">
                    <span :class="labelClass">Agent templates</span>
                    <span class="text-zinc-500 text-[12px] leading-normal">
                        Customise templates for this project. Edits are copy-on-write — they create project overrides and never change the global defaults.
                    </span>
                    <button type="button" :class="[cancelClass, 'self-start']" @click="showTemplates = true">
                        Manage agent templates
                    </button>
                </div>

                <div class="flex gap-2 justify-end">
                    <button type="button" :class="cancelClass" @click="close">Cancel</button>
                    <button
                        type="submit"
                        :disabled="saving"
                        :class="[
                            saved ? 'bg-success' : 'bg-accent',
                            'border-0 rounded text-white text-[12px] font-semibold py-1.5 px-3.5',
                            saving ? 'cursor-default opacity-70' : 'cursor-pointer opacity-100',
                        ]"
                    >
                        {{ saved ? '✓ Saved' : saving ? 'Saving…' : 'Save' }}
                    </button>
                </div>

                <ProjectTemplatesModal
                    v-if="showTemplates"
                    :project-id="props.project.id"
                    :project-name="props.project.name"
                    @close="showTemplates = false"
                />
            </form>
        </template>
    </Modal>
</template>
