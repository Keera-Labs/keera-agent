<script setup lang="ts">
import { ArrowRight, Check, Code, X } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'

export type AskStatus = 'idle' | 'sending' | 'sent' | 'failed'

const props = defineProps<{
    label: string
    fileName: string
    agentName: string | null
    status: AskStatus
    error: string | null
}>()

const emit = defineEmits<{ send: [question: string]; close: [] }>()

const question = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(() => props.agentName !== null && props.status !== 'sending' && question.value.trim() !== '')
const placeholder = computed(() => `Ask ${props.agentName ?? 'the agent'} about these lines…`)

function send() {
    if (canSend.value) emit('send', question.value)
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        e.preventDefault()
        emit('close')
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        send()
    }
}

watch(() => props.status, status => {
    if (status === 'sent') question.value = ''
})

function focus() {
    textarea.value?.focus()
}

onMounted(focus)
defineExpose({ focus })
</script>

<template>
    <div
        role="dialog"
        :aria-label="`Ask about ${label}`"
        data-testid="ask-lines-popover"
        class="absolute z-20 flex flex-col gap-3 p-4 rounded-xl border border-stroke bg-white shadow-[0_12px_32px_-8px_rgba(0,0,0,0.22)]"
    >
        <div class="flex items-center gap-2 min-w-0">
            <Code :size="15" class="shrink-0 text-amber-700" />
            <span class="shrink-0 text-ui-13 font-semibold text-zinc-900" data-testid="ask-lines-label">{{ label }}</span>
            <span class="truncate text-ui-12 text-zinc-500">{{ fileName }}</span>
            <button
                type="button"
                aria-label="Close"
                data-testid="ask-lines-close"
                class="ml-auto shrink-0 p-1 rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 cursor-pointer"
                @click="emit('close')"
            >
                <X :size="14" />
            </button>
        </div>
        <textarea
            ref="textarea"
            v-model="question"
            rows="2"
            data-testid="ask-lines-question"
            :placeholder="placeholder"
            class="w-full resize-none rounded-lg border border-stroke px-3 py-2 text-ui-13 text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-zinc-400"
            @keydown="onKeydown"
        />
        <div class="flex items-center gap-3">
            <p v-if="status === 'failed'" role="alert" class="min-w-0 truncate text-ui-12 text-danger" data-testid="ask-lines-error">
                {{ error ?? 'Could not reach the agent.' }}
            </p>
            <p v-else-if="status === 'sent'" class="flex items-center gap-1 text-ui-12 text-emerald-700" data-testid="ask-lines-sent">
                <Check :size="13" /> Sent to {{ agentName }}
            </p>
            <p v-else-if="agentName === null" class="text-ui-12 text-zinc-500">No agent owns this worktree.</p>
            <kbd class="ml-auto shrink-0 font-sans text-ui-12 text-zinc-500">⌘↵</kbd>
            <button
                type="button"
                data-testid="ask-lines-send"
                :disabled="!canSend"
                class="shrink-0 flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-zinc-900 text-white text-ui-13 font-medium cursor-pointer hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                @click="send"
            >
                {{ status === 'sending' ? 'Sending…' : 'Send to agent' }}
                <ArrowRight :size="14" />
            </button>
        </div>
    </div>
</template>

<style>
.ask-lines-row {
    background-color: #fce9a8;
}

.ask-lines-margin {
    background-color: #f0c02f;
}

.ask-lines-number {
    color: #1c1917 !important;
    font-weight: 600;
}
</style>
