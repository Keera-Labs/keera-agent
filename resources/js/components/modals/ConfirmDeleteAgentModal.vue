<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { cancelBtnClass } from '@/components/ui/styles'

const props = defineProps<{
    agentName: string
    pending?: boolean
    error?: string
    /** Offer closing only the terminal tab, keeping the agent. */
    closeOnly?: boolean
    /** For a PM: how many agents it orchestrates. They are not deleted with it. */
    orchestratedCount?: number
}>()
const emit = defineEmits<{ cancel: []; confirm: []; closeOnly: [] }>()

// Cancel holds focus so a stray Enter never deletes an agent.
const cancelButton = ref<HTMLButtonElement | null>(null)

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !props.pending) emit('cancel')
}

onMounted(() => {
    cancelButton.value?.focus()
    window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
    <Teleport to="body">
        <div
            class="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]"
            data-testid="modal-backdrop"
            @click.self="!pending && emit('cancel')"
        >
            <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-delete-agent-title"
                data-testid="confirm-delete-agent"
                class="bg-modal border border-stroke rounded-md p-6 w-[360px] flex flex-col gap-3.5"
            >
                <h2 id="confirm-delete-agent-title" class="m-0 text-zinc-900 text-[15px] font-semibold">
                    Delete agent {{ agentName }}?
                </h2>
                <p class="m-0 text-zinc-500 text-[13px] leading-normal">
                    This stops its terminal and process and removes the agent.
                </p>
                <p v-if="orchestratedCount" data-testid="confirm-delete-agent-orchestrated" class="m-0 text-zinc-500 text-[13px] leading-normal">
                    This PM orchestrates {{ orchestratedCount }} {{ orchestratedCount === 1 ? 'agent' : 'agents' }}. They are not deleted and keep running.
                </p>
                <span v-if="error" role="alert" class="text-danger text-[12px]">{{ error }}</span>
                <div class="flex gap-2 items-center">
                    <button
                        v-if="closeOnly"
                        type="button"
                        data-testid="confirm-delete-agent-close-only"
                        :disabled="pending"
                        class="bg-transparent border-0 p-0 text-zinc-500 text-[12px] cursor-pointer hover:text-zinc-800 hover:underline"
                        @click="emit('closeOnly')"
                    >
                        Just close tab
                    </button>
                    <div class="flex gap-2 ml-auto">
                        <button
                            ref="cancelButton"
                            type="button"
                            data-testid="confirm-delete-agent-cancel"
                            :disabled="pending"
                            :class="cancelBtnClass"
                            @click="emit('cancel')"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            data-testid="confirm-delete-agent-confirm"
                            :disabled="pending"
                            class="bg-[#da3633] border border-danger rounded text-white text-[12px] py-1.5 px-3.5 cursor-pointer disabled:opacity-60"
                            @click="emit('confirm')"
                        >
                            {{ pending ? 'Deleting…' : 'Delete' }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
