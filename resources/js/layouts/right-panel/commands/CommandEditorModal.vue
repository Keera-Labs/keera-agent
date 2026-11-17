<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Command } from '@/components/commands/types'
import { vFocus } from '@/components/commands/vFocus'
import { cancelBtnClass, inputClass, labelClass, submitBtnClass } from '@/components/ui/styles'
import { useCommandCrud } from '@/composables/useCommandCrud'

const props = defineProps<{ projectId: number; command: Command | null }>()
const emit = defineEmits<{ close: [] }>()

const crud = useCommandCrud(() => props.projectId)

const name = ref(props.command?.label ?? '')
const script = ref(props.command?.command ?? '')
const attempted = ref(false)
const saving = ref(false)
const error = ref('')

const nameMissing = computed(() => attempted.value && !name.value.trim())
const scriptMissing = computed(() => attempted.value && !script.value.trim())

async function save() {
    attempted.value = true
    if (saving.value || !name.value.trim() || !script.value.trim()) return
    error.value = ''
    saving.value = true
    const failure = props.command
        ? await crud.update(props.command, name.value.trim(), script.value.trim())
        : await crud.create(name.value.trim(), script.value.trim())
    saving.value = false
    if (failure) error.value = failure
    else emit('close')
}

function onFormKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    save()
}

function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    emit('close')
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown, { capture: true }))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown, { capture: true }))

const fieldClass = (invalid: boolean) => [inputClass, 'box-border w-full', invalid ? 'border-danger' : 'focus:border-zinc-400']
</script>

<template>
    <Teleport to="body">
        <div
            data-testid="command-editor-backdrop"
            class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
            @click.self="emit('close')"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="command-editor-title"
                data-testid="command-editor"
                class="w-full max-w-[560px] max-h-[calc(100vh-32px)] overflow-y-auto bg-modal border border-stroke rounded-lg p-5 shadow-xl"
            >
                <form class="flex flex-col gap-3.5" novalidate @submit.prevent="save" @keydown="onFormKeydown">
                    <h2 id="command-editor-title" class="m-0 text-ui-15 font-semibold text-zinc-900">
                        {{ command ? 'Edit command' : 'New command' }}
                    </h2>
                    <label class="flex flex-col gap-1">
                        <span :class="labelClass">Name</span>
                        <input
                            v-model="name"
                            v-focus
                            data-testid="command-editor-name"
                            placeholder="Server"
                            :aria-invalid="nameMissing"
                            :class="fieldClass(nameMissing)"
                        >
                        <span v-if="nameMissing" class="text-ui-12 text-danger">Name is required</span>
                    </label>
                    <label class="flex flex-col gap-1">
                        <span :class="labelClass">Script</span>
                        <textarea
                            v-model="script"
                            data-testid="command-editor-script"
                            rows="8"
                            spellcheck="false"
                            autocapitalize="off"
                            autocomplete="off"
                            placeholder="cp ../../../.env ./.env && composer install && php artisan serve --port=8000"
                            :aria-invalid="scriptMissing"
                            :class="[fieldClass(scriptMissing), 'resize-y leading-normal']"
                        />
                        <span v-if="scriptMissing" class="text-ui-12 text-danger">Script is required</span>
                    </label>
                    <p v-if="error" role="alert" data-testid="command-editor-error" class="m-0 text-ui-12 text-danger break-words">{{ error }}</p>
                    <div class="flex flex-wrap items-center justify-end gap-2">
                        <span class="mr-auto text-ui-11 text-zinc-400">⌘/Ctrl + Enter to save</span>
                        <button type="button" data-testid="command-editor-cancel" :class="cancelBtnClass" @click="emit('close')">Cancel</button>
                        <button type="submit" data-testid="command-editor-save" :disabled="saving" :class="[submitBtnClass, 'disabled:opacity-70']">
                            {{ saving ? 'Saving…' : command ? 'Save' : 'Add command' }}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </Teleport>
</template>
