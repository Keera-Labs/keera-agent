<script setup lang="ts">
import { router } from '@inertiajs/vue3'
</script>

<template>
    <header class="shrink-0 bg-white flex items-stretch h-12 border-b border-stroke z-20">
        <!-- Logo zone: same width as the sidebar; doubles as the Dashboard (home) link -->
        <button
            type="button"
            aria-label="Go to Dashboard"
            title="Dashboard"
            class="shrink-0 flex items-center gap-2.5 px-4 text-left cursor-pointer transition-colors hover:bg-black/[0.03] w-[220px] border-r border-stroke"
            @click="router.visit('/')"
        >
            <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-accent">
                <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                </svg>
            </div>
            <span class="font-bold text-[14px] text-zinc-900 tracking-[-0.01em]">Keera Agent</span>
        </button>

        <div class="flex items-stretch flex-1" />
    </header>
</template>
