<script setup lang="ts">
defineProps<{ title: string; count: number }>()
</script>

<template>
    <div class="flex items-baseline gap-2 mb-3">
        <span class="text-zinc-900 text-[15px] font-bold">{{ title }}</span>
        <span class="text-zinc-500 text-[12px] font-semibold font-mono">{{ count }}</span>
    </div>
</template>
