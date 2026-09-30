<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import useWorkspaces from '@/queries/workspacesQuery'
import type { Workspace } from '@/types/type'

const props = defineProps<{ workspace: Workspace }>()
const emit = defineEmits<{ openChange: [open: boolean] }>()

const inputCls = 'bg-canvas border border-stroke rounded-md text-zinc-900 placeholder:text-zinc-500 text-ui-13 px-2.5 py-1.5 font-mono outline-none w-full'
const labelSpanCls = 'text-zinc-600 text-ui-11 uppercase tracking-[0.05em]'
const cancelCls = 'bg-transparent border border-stroke rounded-md text-zinc-700 text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'
const submitCls = 'bg-success border border-success rounded-md text-white text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'

const { update, updating } = useWorkspaces()
const name = ref('')
const description = ref('')
const claudeConfigDir = ref('')
const error = ref('')

function onOpenChange(open: boolean) {
    if (open) {
        name.value = props.workspace.name
        description.value = props.workspace.description ?? ''
        claudeConfigDir.value = props.workspace.claude_config_dir ?? ''
        error.value = ''
    }
    emit('openChange', open)
}

// Mirrors the server rule so the common mistake is caught before a round trip.
const isAbsoluteOrHome = (path: string) => path === '~' || path.startsWith('~/') || path.startsWith('/')

async function handleSubmit(close: () => void) {
    error.value = ''
    const configDir = claudeConfigDir.value.trim()
    if (!name.value.trim()) { error.value = 'Name is required'; return }
    if (configDir && !isAbsoluteOrHome(configDir)) {
        error.value = 'Claude config directory must be an absolute path or start with ~/'
        return
    }
    try {
        await update({
            id: props.workspace.id,
            name: name.value.trim(),
            description: description.value.trim(),
            claude_config_dir: configDir || null,
        })
        close()
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to save workspace settings'
    }
}
</script>

<template>
    <Modal
        aria-label="Workspace settings"
        panel-class="bg-modal border border-stroke rounded-lg p-6 w-[400px] flex flex-col gap-3.5"
        @open-change="onOpenChange"
    >
        <template #trigger><slot name="trigger" /></template>
        <template #default="{ close }">
            <form class="flex flex-col gap-3.5" @submit.prevent="handleSubmit(close)">
                <h2 class="m-0 text-zinc-900 text-ui-15 font-semibold">Workspace Settings</h2>
                <span v-if="error" data-testid="workspace-settings-error" class="text-danger text-xs">{{ error }}</span>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Name</span>
                    <input v-model="name" name="name" required :class="inputCls">
                </label>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Description</span>
                    <input v-model="description" name="description" placeholder="Optional description" :class="inputCls">
                </label>
                <label class="flex flex-col gap-1">
                    <span :class="labelSpanCls">Claude config directory</span>
                    <input v-model="claudeConfigDir" name="claude_config_dir" placeholder="~/.claude" :class="inputCls">
                    <span class="text-zinc-500 text-ui-11 leading-snug">
                        Sets <code>CLAUDE_CONFIG_DIR</code> for Claude agents and the command terminal in this
                        workspace, so they run on a separate Claude account (e.g. <code>~/.claude-work</code>).
                        Leave empty to use the default <code>~/.claude</code>. Applies to agents started after saving.
                    </span>
                    <span data-testid="workspace-settings-setup" class="text-zinc-500 text-ui-11 leading-snug">
                        A new directory needs a one-time setup first: run
                        <code>CLAUDE_CONFIG_DIR=&lt;dir&gt; claude</code> in a terminal to log in, then accept
                        workspace trust in each project. Until then agents fail with "Workspace trust not accepted".
                    </span>
                </label>
                <div class="flex gap-2 justify-end">
                    <button type="button" :class="cancelCls" @click="close">Cancel</button>
                    <button type="submit" :disabled="updating" :class="submitCls">
                        {{ updating ? 'Saving…' : 'Save' }}
                    </button>
                </div>
            </form>
        </template>
    </Modal>
</template>
