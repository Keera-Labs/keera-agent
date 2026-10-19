<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommandCrud } from '@/composables/useCommandCrud'
import { useCommands } from '@/queries/commandQuery'
import CommandForm from './CommandForm.vue'
import CommandRow from './CommandRow.vue'
import Icon from './Icon.vue'
import type { Command } from './types'

const props = defineProps<{ projectId: number }>()

const crud = useCommandCrud(() => props.projectId)
const query = useCommands(() => props.projectId)
const commands = computed(() => query.data.value ?? [])
const showForm = ref(false)
const deleteError = ref('')

async function handleCreate(label: string, command: string): Promise<string | null> {
    const error = await crud.create(label, command)
    if (!error) showForm.value = false
    return error
}

const handleUpdate = (c: Command, label: string, command: string) => crud.update(c, label, command)

async function handleDelete(c: Command) {
    deleteError.value = (await crud.remove(c)) ?? ''
}
</script>

<template>
    <div class="flex-1 flex flex-col overflow-hidden">
        <div class="py-2.5 px-5 border-b border-stroke flex items-center gap-2 shrink-0 bg-canvas">
            <Icon name="terminal" :size="13" class="text-zinc-500" />
            <span class="text-zinc-900 text-ui-13 font-semibold flex-1">Commands</span>
            <slot name="toolbar" />
            <button
                :class="[
                    'border rounded-[5px] text-ui-11 py-1 px-2.5 cursor-pointer flex items-center gap-[5px]',
                    showForm ? 'bg-surface border-stroke text-zinc-500' : 'bg-success border-success text-white',
                ]"
                @click="showForm = !showForm"
            >
                <template v-if="showForm">× Cancel</template>
                <template v-else>
                    <Icon name="plus" :size="10" />
                    New command
                </template>
            </button>
        </div>

        <CommandForm v-if="showForm" :on-create="handleCreate" @cancel="showForm = false" />

        <div v-if="deleteError" role="alert" data-testid="commands-delete-error" class="py-1.5 px-5 text-ui-12 text-danger border-b border-stroke">
            {{ deleteError }}
        </div>

        <div v-if="query.error.value" data-testid="commands-error" class="flex-1 flex items-center justify-center">
            <span class="text-danger text-ui-13">Could not load commands.</span>
        </div>
        <div v-else-if="query.data.value === undefined" data-testid="commands-loading" class="flex-1 flex items-center justify-center">
            <span class="text-zinc-400 text-ui-13">Loading commands…</span>
        </div>
        <div
            v-else-if="commands.length === 0"
            class="flex-1 flex flex-col items-center justify-center gap-3 py-10 px-6 text-center"
        >
            <div class="w-12 h-12 rounded-full bg-surface border border-stroke flex items-center justify-center text-zinc-400">
                <Icon name="terminal" :size="22" />
            </div>
            <div>
                <p class="mt-0 mr-0 mb-1 ml-0 text-zinc-700 text-ui-13 font-medium">No commands yet</p>
                <p class="m-0 text-zinc-400 text-ui-12 leading-normal">
                    Add build scripts, dev servers,<br />or any long-running process.
                </p>
            </div>
            <button
                class="bg-transparent border border-dashed border-stroke rounded text-zinc-500 text-ui-12 py-1.5 px-3.5 cursor-pointer hover:border-accent hover:text-accent"
                @click="showForm = true"
            >
                + Add your first command
            </button>
        </div>
        <div v-else class="flex-1 overflow-y-auto flex flex-col">
            <CommandRow
                v-for="c in commands"
                :key="c.id"
                :command="c"
                :on-update="(label: string, cmd: string) => handleUpdate(c, label, cmd)"
                @delete="handleDelete(c)"
            />
            <button
                class="flex items-center gap-1.5 py-[9px] px-3.5 bg-transparent border-none text-zinc-400 text-ui-11 cursor-pointer w-full text-left hover:text-zinc-500 hover:bg-surface"
                @click="showForm = true"
            >
                <Icon name="plus" :size="10" />
                Add command
            </button>
        </div>
    </div>
</template>
