<script setup lang="ts">
import AppLayout from '@/layouts/AppLayout.vue'
import ProjectLayout from '@/layouts/ProjectLayout.vue'

// Nested persistent layouts: Inertia keeps both mounted across navigations
// between pages that declare the same array.
defineOptions({ layout: [AppLayout, ProjectLayout] })
</script>

<template>
    <div>Home</div>
</template>
