<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import { onMounted } from 'vue'
import { isSettingsSection } from '@/layouts/settings/sections'
import { useAppLayoutStore } from '@/stores/appLayoutStore'

// Settings live in a modal; this page only keeps /settings (and ?section=editor) working as a link.
const layout = useAppLayoutStore()

onMounted(() => {
    const section = new URLSearchParams(window.location.search).get('section')
    layout.openSettings(isSettingsSection(section) ? section : undefined)
})
</script>

<template>
    <Head title="Settings" />
    <div class="flex-1 bg-surface" />
</template>
