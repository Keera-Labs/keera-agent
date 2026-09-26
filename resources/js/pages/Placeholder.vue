<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3'

const page = usePage()
</script>

<template>
    <Head title="Migrating" />
    <main class="flex h-screen w-full flex-col items-center justify-center gap-2 bg-canvas text-zinc-500">
        <h1 class="text-[15px] font-semibold text-zinc-900">Keera Agent</h1>
        <p class="text-[13px]">
            The <code class="font-mono text-zinc-700">{{ page.component }}</code> page is being migrated to Vue.
        </p>
    </main>
</template>
