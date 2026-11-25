<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useToastStore } from '@/stores/toastStore'

const toast = useToastStore()
const { message } = storeToRefs(toast)
</script>

<template>
    <div class="fixed bottom-4 inset-x-4 z-50 flex justify-center pointer-events-none">
        <div
            v-if="message"
            role="status"
            data-testid="toast"
            class="pointer-events-auto flex items-center gap-3 max-w-md py-2 pl-3 pr-2 rounded-lg bg-zinc-900 text-white text-ui-13 shadow-lg"
        >
            <span class="flex-1 min-w-0">{{ message }}</span>
            <button
                type="button"
                aria-label="Dismiss"
                class="shrink-0 w-6 h-6 rounded-md text-zinc-300 cursor-pointer hover:bg-white/10"
                @click="toast.dismiss()"
            >
                ×
            </button>
        </div>
    </div>
</template>
