<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Project } from '@/types/type'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: []; updated: [project: Project] }>()

const prompt = ref(props.project.system_prompt ?? '')
const error = ref('')
const loading = ref(false)

// Follow the project prop when its data refreshes after the modal has opened.
watch(() => props.project.system_prompt, value => { prompt.value = value ?? '' })

async function handleSubmit() {
    error.value = ''
    loading.value = true
    try {
        const res = await fetch(`/api/projects/${props.project.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system_prompt: prompt.value.trim() || null }),
        })
        const data = await res.json()
        if (!res.ok) {
            error.value = data.error ?? 'Something went wrong'
            return
        }
        emit('updated', data as Project)
        emit('close')
    } catch {
        error.value = 'Network error'
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
        <div class="bg-[#1c1f26] border border-[#2a2f3a] rounded-md p-6 w-[480px] flex flex-col gap-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
            <form class="flex flex-col gap-3.5" @submit.prevent="handleSubmit">
                <div>
                    <h2 class="mt-0 mx-0 mb-1 text-[#f0f6fc] text-[15px] font-semibold">
                        System Instructions —
                        <span class="font-mono text-accent">{{ project.name }}</span>
                    </h2>
                    <p class="m-0 text-[#8b949e] text-[11px]">
                        Instructions passed to Claude when a new agent session starts. Leave blank to use no system prompt.
                    </p>
                </div>
                <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
                <label class="flex flex-col gap-1">
                    <span class="text-[#8b949e] text-[11px] uppercase tracking-[0.05em]">System prompt</span>
                    <textarea
                        v-model="prompt"
                        placeholder="You are a helpful assistant specialized in..."
                        rows="8"
                        class="bg-[#0d1117] border border-[#2a2f3a] rounded text-[#e2e6ed] text-[12px] py-[7px] px-2.5 outline-none resize-y font-mono leading-normal"
                    />
                </label>
                <div class="flex gap-2 justify-end">
                    <button
                        type="button"
                        class="bg-transparent border border-[#2a2f3a] rounded text-[#8b949e] text-[12px] py-1.5 px-3.5 cursor-pointer"
                        @click="emit('close')"
                    >Cancel</button>
                    <button
                        type="submit"
                        :disabled="loading"
                        :class="[
                            'bg-blue-600 border-0 rounded text-white text-[12px] font-semibold py-1.5 px-3.5',
                            loading ? 'cursor-default opacity-70' : 'cursor-pointer opacity-100',
                        ]"
                    >
                        {{ loading ? 'Saving…' : 'Save' }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>
