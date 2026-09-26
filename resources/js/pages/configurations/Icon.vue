<script setup lang="ts">
// Lucide icon geometry inlined so the page does not pull in a Vue icon package.
export type IconName = 'terminal' | 'plus' | 'x' | 'pencil' | 'play' | 'square'

withDefaults(defineProps<{ name: IconName; size?: number; filled?: boolean }>(), { size: 24, filled: false })
</script>

<template>
    <svg
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        :fill="filled ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        <template v-if="name === 'terminal'">
            <path d="M12 19h8" />
            <path d="m4 17 6-6-6-6" />
        </template>
        <template v-else-if="name === 'plus'">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
        </template>
        <template v-else-if="name === 'x'">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </template>
        <template v-else-if="name === 'pencil'">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
            <path d="m15 5 4 4" />
        </template>
        <path v-else-if="name === 'play'" d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
        <rect v-else-if="name === 'square'" width="18" height="18" x="3" y="3" rx="2" />
    </svg>
</template>
