<script setup lang="ts">
defineProps<{ label: string; value: number; dot: string }>()
</script>

<template>
    <div class="flex-1 min-w-0 bg-surface border border-stroke rounded-md py-[14px] px-4">
        <div class="flex items-center gap-1.5 mb-2">
            <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: dot }" />
            <span class="text-zinc-500 text-[11px] font-semibold uppercase tracking-[0.04em]">{{ label }}</span>
        </div>
        <div class="text-zinc-900 text-[28px] font-bold leading-none">
            {{ value }}
        </div>
    </div>
</template>
