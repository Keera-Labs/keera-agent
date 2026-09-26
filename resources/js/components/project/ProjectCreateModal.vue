<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import useProjects from '@/queries/projectsQuery'
import useWorkspaces from '@/queries/workspacesQuery'
import type { Project } from '@/types/type'

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']

const ERROR_MAP: Record<string, string> = {
    path_not_found: 'Path does not exist on disk.',
}

const inputCls = 'bg-canvas border border-stroke rounded-md text-zinc-900 placeholder:text-zinc-500 text-[13px] px-2.5 py-1.5 font-mono outline-none w-full'
const labelSpanCls = 'text-zinc-600 text-[11px] uppercase tracking-[0.05em]'
const cancelCls = 'bg-transparent border border-stroke rounded-md text-zinc-700 text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'
const submitCls = 'bg-success border border-success rounded-md text-white text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'

const props = defineProps<{ defaultWorkspaceId: number | null }>()

defineSlots<{ trigger(): unknown }>()

const { workspaces } = useWorkspaces()
const { handleProjectCreated } = useProjects()

const name = ref('')
const path = ref('')
const language = ref('Python')
const workspaceId = ref<number | null>(null)
const processing = ref(false)
const error = ref('')
const confirmCreate = ref<{ expanded: string } | null>(null)

// Fresh form each time the modal opens (it stays mounted between opens).
function resetForm() {
    name.value = ''
    path.value = ''
    language.value = 'Python'
    workspaceId.value = props.defaultWorkspaceId ?? workspaces.value[0]?.id ?? null
    processing.value = false
    error.value = ''
    confirmCreate.value = null
}

function onOpenChange(open: boolean) {
    if (open) resetForm()
}

async function submit(close: () => void, createDir = false) {
    error.value = ''
    processing.value = true
    try {
        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.value,
                path: path.value,
                language: language.value,
                workspace_id: workspaceId.value,
                create_dir: createDir,
            }),
        })
        const json = await res.json() as Record<string, unknown>
        if (res.ok) {
            handleProjectCreated(json as unknown as Project)
            close()
            return
        }
        const code = (json.error ?? json.detail ?? '') as string
        if (code === 'path_not_found' && !createDir) {
            confirmCreate.value = { expanded: (json.expanded as string | undefined) ?? path.value }
            return
        }
        confirmCreate.value = null
        error.value = ERROR_MAP[code] ?? (code || 'Something went wrong.')
    } catch {
        error.value = 'Network error. Please try again.'
    } finally {
        processing.value = false
    }
}
</script>

<template>
    <Modal aria-label="Add project" @open-change="onOpenChange">
        <template #trigger>
            <slot name="trigger" />
        </template>

        <template #default="{ close }">
            <template v-if="confirmCreate">
                <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">Directory not found</h2>
                <p class="m-0 text-zinc-700 text-[13px] leading-relaxed">
                    <span class="text-zinc-900 font-mono text-xs">{{ confirmCreate.expanded }}</span>
                    does not exist. Create it?
                </p>
                <span v-if="error" class="text-danger text-xs">{{ error }}</span>
                <div class="flex gap-2 justify-end">
                    <button type="button" :class="cancelCls" @click="confirmCreate = null">Back</button>
                    <button type="button" :disabled="processing" :class="submitCls" @click="submit(close, true)">
                        {{ processing ? 'Creating…' : 'Create & Add' }}
                    </button>
                </div>
            </template>

            <form v-else class="flex flex-col gap-3.5" @submit.prevent="submit(close)">
                <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">New Project</h2>
                <span v-if="error" class="text-danger text-xs">{{ error }}</span>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Workspace</span>
                    <select v-model="workspaceId" name="workspace" :class="inputCls">
                        <option :value="null">— No workspace —</option>
                        <option v-for="w in workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Name</span>
                    <input v-model="name" name="name" placeholder="my-project" required :class="inputCls">
                </label>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Path</span>
                    <input v-model="path" name="path" placeholder="~/code/my-project" required :class="inputCls">
                </label>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Language</span>
                    <select v-model="language" name="language" :class="inputCls">
                        <option v-for="l in LANGUAGES" :key="l" :value="l">{{ l }}</option>
                    </select>
                </label>
                <div class="flex gap-2 justify-end">
                    <button type="button" :class="cancelCls" @click="close">Cancel</button>
                    <button type="submit" :disabled="processing" :class="submitCls">
                        {{ processing ? 'Checking…' : 'Add Project' }}
                    </button>
                </div>
            </form>
        </template>
    </Modal>
</template>
