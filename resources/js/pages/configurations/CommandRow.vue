<script setup lang="ts">
import { computed, ref } from 'vue'
import { cancelBtnClass, inputClass, submitBtnClass } from '@/components/ui/styles'
import Icon from './Icon.vue'
import type { Command } from './types'
import { vFocus } from './vFocus'

// Owns only its inline-edit state; process and persistence actions go to the parent panel.
const props = defineProps<{
    command: Command
    isSelected: boolean
    onUpdate: (label: string, cmd: string) => Promise<boolean>
}>()
const emit = defineEmits<{ select: []; run: []; stop: []; delete: [] }>()

const isRunning = computed(() => props.command.status === 'running')
const editing = ref(false)
const editLabel = ref('')
const editCmd = ref('')
const saving = ref(false)

function startEditing() {
    editLabel.value = props.command.label
    editCmd.value = props.command.command
    editing.value = true
}

async function handleSave() {
    saving.value = true
    const ok = await props.onUpdate(editLabel.value.trim(), editCmd.value.trim())
    saving.value = false
    if (ok) editing.value = false
}
</script>

<template>
    <form
        v-if="editing"
        class="flex flex-col gap-2 py-2.5 px-3.5 bg-surface border-l-2 border-l-accent border-b border-b-stroke"
        @submit.prevent="handleSave"
    >
        <input
            v-model="editLabel"
            v-focus
            placeholder="Label"
            required
            :class="`${inputClass} box-border w-full`"
        />
        <input
            v-model="editCmd"
            placeholder="Shell command"
            required
            :class="`${inputClass} box-border w-full font-mono`"
        />
        <div class="flex gap-1.5 justify-end">
            <button type="button" :class="cancelBtnClass" @click="editing = false">Cancel</button>
            <button type="submit" :disabled="saving" :class="submitBtnClass">
                {{ saving ? 'Saving…' : 'Save' }}
            </button>
        </div>
    </form>

    <div
        v-else
        :class="[
            'flex items-center gap-2.5 py-2.5 px-3.5 cursor-pointer border-l-2 border-b border-b-stroke transition-colors duration-100 hover:bg-surface',
            isSelected ? 'bg-surface border-l-accent' : 'bg-transparent border-l-transparent',
        ]"
        @click="emit('select')"
    >
        <button
            :title="isRunning ? 'Stop' : 'Run'"
            :class="[
                'w-[30px] h-[30px] rounded-full shrink-0 border flex items-center justify-center cursor-pointer transition-all duration-150',
                isRunning
                    ? 'bg-[rgba(63,185,80,0.1)] border-[rgba(63,185,80,0.4)] text-success hover:border-danger hover:text-danger hover:bg-red-50'
                    : 'bg-canvas border-stroke text-zinc-500 hover:border-success hover:text-success hover:bg-[rgba(63,185,80,0.1)]',
            ]"
            @click.stop="isRunning ? emit('stop') : emit('run')"
        >
            <Icon :name="isRunning ? 'square' : 'play'" :size="9" filled />
        </button>

        <div class="flex-1 min-w-0">
            <div class="text-[12px] font-semibold text-zinc-900 font-mono truncate">/{{ command.label }}</div>
            <div class="text-[10px] text-zinc-400 font-mono truncate mt-0.5">{{ command.command }}</div>
        </div>

        <span
            v-if="isRunning"
            class="text-[10px] py-px px-1.5 rounded-md bg-[rgba(63,185,80,0.08)] border border-[rgba(63,185,80,0.25)] text-success font-mono shrink-0 [animation:cmd-pulse_2s_infinite]"
        >
            {{ command.pid ? `pid ${command.pid}` : 'running' }}
        </span>

        <button
            title="Edit"
            class="shrink-0 bg-transparent border-none text-zinc-400 cursor-pointer py-[3px] px-1 rounded-sm flex items-center hover:text-accent hover:bg-canvas"
            @click.stop="startEditing"
        >
            <Icon name="pencil" :size="11" />
        </button>

        <button
            title="Delete"
            class="shrink-0 bg-transparent border-none text-zinc-400 cursor-pointer py-[3px] px-1 leading-none rounded-sm flex items-center hover:text-danger hover:bg-red-50"
            @click.stop="emit('delete')"
        >
            <Icon name="x" :size="11" />
        </button>
    </div>
</template>
