<script setup lang="ts">
import AppLayout from '@/layouts/AppLayout.vue'
import ProjectLayout from '@/layouts/ProjectLayout.vue'

// Nested persistent layouts — see Home.vue.
defineOptions({ layout: [AppLayout, ProjectLayout] })
</script>

<template></template>
