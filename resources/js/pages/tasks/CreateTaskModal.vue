<script setup lang="ts">
import { computed, ref, type Directive } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import TagInput from '@/components/ui/TagInput.vue'
import { cancelBtnClass, inputClass, labelClass, submitBtnClass } from '@/components/ui/styles'
import type { Project, Workspace } from '@/types/type'

export type NewTask = { title: string; body: string; assignees: string[]; projectId: number }

const LS_TASK_PROJECT_ID = 'keera:task_project_id'
const LS_TASK_WORKSPACE_ID = 'keera:task_workspace_id'

const props = defineProps<{
    projects: Project[]
    workspaces: Workspace[]
    defaultProjectId: number | null
}>()

const emit = defineEmits<{ created: [task: NewTask] }>()

defineSlots<{ trigger(): unknown }>()

// Read on every open rather than cached in a ref: the board renders one modal per
// "new task" trigger, and each must see the picker choice the other one saved.
function readStoredId(key: string): number | null {
    try {
        const stored = localStorage.getItem(key)
        return stored === null ? null : parseInt(stored, 10)
    } catch {
        return null
    }
}

function storeId(key: string, id: number | null) {
    try {
        if (id === null) localStorage.removeItem(key)
        else localStorage.setItem(key, String(id))
    } catch {
        // Storage unavailable: the picker just won't be remembered.
    }
}

const title = ref('')
const body = ref('')
const assignees = ref<string[]>([])
const error = ref('')
const selectedWorkspaceId = ref<number | null>(null)
const selectedProjectId = ref<number | null>(null)

function initialWorkspaceId(): number | null {
    const stored = readStoredId(LS_TASK_WORKSPACE_ID)
    if (stored !== null && props.workspaces.some(w => w.id === stored)) return stored
    return props.projects.find(p => p.id === props.defaultProjectId)?.workspace_id ?? null
}

function initialProjectId(): number | null {
    const stored = readStoredId(LS_TASK_PROJECT_ID)
    if (stored !== null && props.projects.some(p => p.id === stored)) return stored
    return props.defaultProjectId
}

function onOpenChange(open: boolean) {
    if (!open) return
    title.value = ''
    body.value = ''
    assignees.value = []
    error.value = ''
    selectedWorkspaceId.value = initialWorkspaceId()
    selectedProjectId.value = initialProjectId()
}

const visibleProjects = computed(() =>
    selectedWorkspaceId.value !== null
        ? props.projects.filter(p => p.workspace_id === selectedWorkspaceId.value)
        : props.projects,
)

function onWorkspaceChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value
    const id = value === '' ? null : parseInt(value, 10)
    selectedWorkspaceId.value = id
    storeId(LS_TASK_WORKSPACE_ID, id)
    const first = id !== null ? props.projects.find(p => p.workspace_id === id) : props.projects[0]
    selectedProjectId.value = first?.id ?? null
    storeId(LS_TASK_PROJECT_ID, selectedProjectId.value)
}

function onProjectChange(event: Event) {
    const id = parseInt((event.target as HTMLSelectElement).value, 10)
    selectedProjectId.value = id
    storeId(LS_TASK_PROJECT_ID, id)
}

function submit(close: () => void) {
    if (!title.value.trim()) { error.value = 'Title is required'; return }
    if (!selectedProjectId.value) { error.value = 'Select a project'; return }
    emit('created', {
        title: title.value.trim(),
        body: body.value.trim(),
        assignees: assignees.value,
        projectId: selectedProjectId.value,
    })
    close()
}

// `autofocus` is ignored on elements inserted after page load, and the form mounts on open.
const vFocus: Directive<HTMLElement> = { mounted: el => el.focus() }

// A literal hex, not a token: TagInput appends alpha suffixes, which a var() cannot take.
const ASSIGNEE_COLOR = '#2563eb'

const selectClass = `${inputClass} w-full box-border cursor-pointer`
</script>

<template>
    <Modal
        aria-label="New task"
        panel-class="bg-modal border border-stroke rounded-md p-6 w-[420px] flex flex-col gap-4"
        @open-change="onOpenChange"
    >
        <template #trigger>
            <slot name="trigger" />
        </template>

        <template #default="{ close }">
            <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">New Task</h2>

            <span v-if="error" role="alert" class="text-danger text-[12px]">{{ error }}</span>

            <form class="flex flex-col gap-3.5" @submit.prevent="submit(close)">
                <div class="flex gap-2">
                    <label v-if="workspaces.length > 0" class="flex flex-col gap-1 flex-1">
                        <span :class="labelClass">Workspace</span>
                        <select
                            name="workspace"
                            :value="selectedWorkspaceId ?? ''"
                            :class="selectClass"
                            @change="onWorkspaceChange"
                        >
                            <option value="">All</option>
                            <option v-for="w in workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
                        </select>
                    </label>
                    <label class="flex flex-col gap-1 flex-1">
                        <span :class="labelClass">Project <span class="text-danger">*</span></span>
                        <select
                            name="project"
                            :value="selectedProjectId ?? ''"
                            :class="selectClass"
                            @change="onProjectChange"
                        >
                            <option value="" disabled>Select project</option>
                            <option v-for="p in visibleProjects" :key="p.id" :value="p.id">{{ p.name }}</option>
                        </select>
                    </label>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Title <span class="text-danger">*</span></span>
                    <input
                        v-model="title"
                        v-focus
                        name="title"
                        placeholder="Task title"
                        :class="[inputClass, 'w-full box-border']"
                        @input="error = ''"
                    >
                </label>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Description</span>
                    <textarea
                        v-model="body"
                        name="body"
                        placeholder="Optional details…"
                        rows="3"
                        :class="[inputClass, 'w-full box-border resize-y leading-normal']"
                    />
                </label>

                <div class="flex flex-col gap-1.5">
                    <span :class="labelClass">Assignees</span>
                    <TagInput v-model="assignees" placeholder="Add name and press Enter" :tag-color="ASSIGNEE_COLOR" />
                </div>

                <div class="flex gap-2 justify-end pt-1">
                    <button type="button" :class="cancelBtnClass" @click="close">Cancel</button>
                    <button type="submit" :class="submitBtnClass">Create Task</button>
                </div>
            </form>
        </template>
    </Modal>
</template>
