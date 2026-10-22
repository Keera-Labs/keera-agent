<script setup lang="ts">
defineProps<{ detail: string; compact?: boolean }>()
</script>

<template>
    <span v-if="compact" data-testid="question-detail" class="block font-mono text-ui-12 text-zinc-600 truncate">{{ detail }}</span>
    <pre
        v-else
        data-testid="question-detail"
        class="m-0 max-h-48 overflow-auto px-3 py-2 rounded-lg bg-zinc-900 text-zinc-100 font-mono text-ui-12 whitespace-pre-wrap break-all"
    >{{ detail }}</pre>
</template>
