<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
    <div class="flex flex-1 items-center justify-center p-12 text-zinc-400 text-[13px]">
        {{ text }}
    </div>
</template>
