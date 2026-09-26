<script setup lang="ts">
import { ref } from 'vue'
import { cancelBtnClass, inputClass, labelClass, submitBtnClass } from '@/components/ui/styles'
import { vFocus } from './vFocus'

// The parent performs the API call and resolves to an error message, or null on success.
const props = defineProps<{ onCreate: (label: string, command: string) => Promise<string | null> }>()
const emit = defineEmits<{ cancel: [] }>()

const label = ref('')
const cmd = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
    error.value = ''
    loading.value = true
    const err = await props.onCreate(label.value.trim(), cmd.value.trim())
    loading.value = false
    if (err) error.value = err
}
</script>

<template>
    <div class="py-[14px] px-5 border-b border-stroke bg-surface shrink-0">
        <form class="flex flex-col gap-2.5" @submit.prevent="handleSubmit">
            <div class="flex gap-2.5">
                <div class="flex flex-col gap-1 flex-[0_0_180px]">
                    <span :class="labelClass">Label</span>
                    <input
                        v-model="label"
                        v-focus
                        placeholder="Dev Server"
                        required
                        :class="`${inputClass} box-border w-full`"
                    />
                </div>
                <div class="flex flex-col gap-1 flex-1">
                    <span :class="labelClass">Shell command</span>
                    <input
                        v-model="cmd"
                        placeholder="npm run dev"
                        required
                        :class="`${inputClass} box-border w-full font-mono`"
                    />
                </div>
            </div>
            <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
            <div class="flex gap-2 justify-end">
                <button type="button" :class="cancelBtnClass" @click="emit('cancel')">Cancel</button>
                <button type="submit" :disabled="loading" :class="submitBtnClass">
                    {{ loading ? 'Adding…' : 'Add command' }}
                </button>
            </div>
        </form>
    </div>
</template>
