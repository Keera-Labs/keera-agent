<script setup lang="ts">
import { computed } from 'vue'

const PRIORITY_CLASSES: Record<string, string> = {
    low:    'bg-surface text-zinc-500 border-stroke',
    medium: 'bg-amber-50 text-amber-700 border-amber-100',
    high:   'bg-red-50 text-danger border-red-50',
}

const props = defineProps<{ priority: string }>()

const colorClass = computed(() => PRIORITY_CLASSES[props.priority] ?? PRIORITY_CLASSES.medium)
</script>

<template>
    <span :class="['text-[10px] font-semibold tracking-[0.04em] py-px px-1.5 rounded-lg border uppercase shrink-0', colorClass]">
        {{ priority }}
    </span>
</template>
