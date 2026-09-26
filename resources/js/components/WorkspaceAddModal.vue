<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import useWorkspaces from '@/queries/workspacesQuery'

const emit = defineEmits<{ openChange: [open: boolean] }>()

const inputCls = 'bg-canvas border border-stroke rounded-md text-zinc-900 placeholder:text-zinc-500 text-[13px] px-2.5 py-1.5 font-mono outline-none w-full'
const labelSpanCls = 'text-zinc-600 text-[11px] uppercase tracking-[0.05em]'
const cancelCls = 'bg-transparent border border-stroke rounded-md text-zinc-700 text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'
const submitCls = 'bg-success border border-success rounded-md text-white text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'

const { create, creating } = useWorkspaces()
const name = ref('')
const description = ref('')
const error = ref('')

function reset() {
    name.value = ''
    description.value = ''
    error.value = ''
}

function onOpenChange(open: boolean) {
    // The React form remounted on every open; clearing on close keeps that behaviour.
    if (!open) reset()
    emit('openChange', open)
}

async function handleSubmit(close: () => void) {
    error.value = ''
    if (!name.value.trim()) { error.value = 'Name is required'; return }
    try {
        await create({ name: name.value.trim(), description: description.value.trim() || undefined })
        close()
    } catch {
        error.value = 'Failed to create workspace'
    }
}
</script>

<template>
    <Modal aria-label="New workspace" @open-change="onOpenChange">
        <template #trigger><slot name="trigger" /></template>
        <template #default="{ close }">
            <form class="flex flex-col gap-3.5" @submit.prevent="handleSubmit(close)">
                <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">New Workspace</h2>
                <span v-if="error" class="text-danger text-xs">{{ error }}</span>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Name</span>
                    <input v-model="name" name="name" placeholder="my-workspace" required :class="inputCls">
                </label>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Description</span>
                    <input v-model="description" name="description" placeholder="Optional description" :class="inputCls">
                </label>
                <div class="flex gap-2 justify-end">
                    <button type="button" :class="cancelCls" @click="close">Cancel</button>
                    <button type="submit" :disabled="creating" :class="submitCls">
                        {{ creating ? 'Creating…' : 'Create' }}
                    </button>
                </div>
            </form>
        </template>
    </Modal>
</template>
