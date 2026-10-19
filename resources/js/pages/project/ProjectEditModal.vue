<script setup lang="ts">
import { ref, watch } from 'vue'
import ProjectTemplatesModal from '@/components/modals/ProjectTemplatesModal.vue'
import Modal from '@/components/ui/Modal.vue'
import TagInput from '@/components/ui/TagInput.vue'
import useProjects from '@/queries/projectsQuery'
import { useWorktreeFiles } from '@/queries/worktreeFilesQuery'
import { color } from '@/tokens'
import type { Project } from '@/types/type'

const inputClass = 'bg-canvas border border-stroke rounded text-zinc-900 text-ui-13 py-[7px] px-2.5 outline-none w-full box-border font-mono'
const labelClass = 'text-zinc-700 text-ui-11 uppercase tracking-[0.05em]'
const cancelClass = 'bg-transparent border border-stroke rounded text-zinc-700 text-ui-12 py-1.5 px-3.5 cursor-pointer'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ openChange: [open: boolean] }>()
defineSlots<{ trigger(): unknown }>()

const { handleProjectUpdated } = useProjects()
const worktreeFiles = useWorktreeFiles(() => props.project.id)

const path = ref(props.project.path)
const copyPaths = ref<string[]>([])
const copyPathsEdited = ref(false)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const showTemplates = ref(false)

watch(worktreeFiles.paths, paths => {
    if (!copyPathsEdited.value) copyPaths.value = [...(paths ?? [])]
}, { immediate: true })

function editCopyPaths(paths: string[]) {
    copyPathsEdited.value = true
    copyPaths.value = paths
}

function onOpenChange(open: boolean) {
    if (open) {
        path.value = props.project.path
        copyPaths.value = [...(worktreeFiles.paths.value ?? [])]
        copyPathsEdited.value = false
        saving.value = false
        saved.value = false
        error.value = ''
        showTemplates.value = false
        void worktreeFiles.refetch()
    }
    emit('openChange', open)
}

async function save(close: () => void) {
    saving.value = true
    error.value = ''
    try {
        try {
            await worktreeFiles.save(copyPaths.value)
        } catch (e) {
            error.value = e instanceof Error ? e.message : 'Failed to save worktree files'
            return
        }
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
                    <h2 class="m-0 text-zinc-900 text-ui-15 font-bold">Edit project</h2>
                    <p class="mt-[3px] mx-0 mb-0 text-accent text-ui-12 font-mono">{{ props.project.name }}</p>
                </div>

                <span v-if="error" class="text-danger text-ui-12">{{ error }}</span>

                <label class="flex flex-col gap-1.5">
                    <span :class="labelClass">Path</span>
                    <span class="text-zinc-500 text-ui-12 leading-normal">
                        Local filesystem path. Claude Code will run from this directory.
                    </span>
                    <input v-model="path" name="path" placeholder="~/code/my-project" required :class="inputClass">
                </label>

                <div class="flex flex-col gap-1.5" data-testid="worktree-files">
                    <span :class="labelClass">Worktree files</span>
                    <span class="text-zinc-500 text-ui-12 leading-normal">
                        Copied from this project into each new agent worktree, e.g. <code>.env</code> or <code>config/*.local.json</code>. Paths are relative to the project root; files already in the worktree are kept. Meant for gitignored files: copied files git tracks as changes keep the worktree from being cleaned up automatically.
                    </span>
                    <TagInput
                        :model-value="copyPaths"
                        @update:model-value="editCopyPaths"
                        placeholder="Add a path or glob and press Enter"
                        :tag-color="color.accent"
                        :disabled="worktreeFiles.isLoading.value"
                    />
                </div>

                <div class="flex flex-col gap-2 border-t border-stroke pt-4">
                    <span :class="labelClass">Agent templates</span>
                    <span class="text-zinc-500 text-ui-12 leading-normal">
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
                            'border-0 rounded text-white text-ui-12 font-semibold py-1.5 px-3.5',
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
