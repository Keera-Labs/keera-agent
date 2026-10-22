import { defineStore } from 'pinia'
import { ref } from 'vue'

export const TOAST_DURATION_MS = 5000

export const useToastStore = defineStore('toast', () => {
    const message = ref<string | null>(null)
    let timer: ReturnType<typeof setTimeout> | undefined

    function show(text: string) {
        message.value = text
        clearTimeout(timer)
        timer = setTimeout(dismiss, TOAST_DURATION_MS)
    }

    function dismiss() {
        clearTimeout(timer)
        message.value = null
    }

    return { message, show, dismiss }
})
