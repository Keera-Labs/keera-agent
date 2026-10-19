<script setup lang="ts">
import { Code, Eye } from '@lucide/vue'
import type { MarkdownViewMode } from '@/composables/useMarkdownViewMode'

const mode = defineModel<MarkdownViewMode>({ required: true })

const options = [
    { value: 'code', label: 'Code', icon: Code },
    { value: 'preview', label: 'Preview', icon: Eye },
] as const
</script>

<template>
    <div class="shrink-0 flex items-center gap-0.5 p-0.5 rounded bg-zinc-100" role="group" aria-label="Markdown view" data-testid="markdown-view-toggle">
        <button
            v-for="option in options"
            :key="option.value"
            type="button"
            :data-testid="`markdown-view-${option.value}`"
            :aria-pressed="mode === option.value"
            :class="[
                'h-5 px-1.5 flex items-center gap-1 rounded-sm cursor-pointer transition-colors',
                mode === option.value ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-800',
            ]"
            @click="mode = option.value"
        >
            <component :is="option.icon" :size="12" /> {{ option.label }}
        </button>
    </div>
</template>
