<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { computed } from 'vue'
import { avatarColor, FolderIcon, projectStatusSummary } from './helpers'
import type { DashboardProject } from './types'

const props = defineProps<{ project: DashboardProject }>()

const summary = computed(() => projectStatusSummary(props.project))
</script>

<template>
    <button
        type="button"
        :title="`Open ${project.name}`"
        class="text-left cursor-pointer w-full bg-surface border border-stroke rounded-md p-[14px] flex flex-col gap-3 hover:border-accent"
        style="font: inherit"
        @click="router.visit(`/${project.slug}`)"
    >
        <div class="flex items-center gap-2">
            <FolderIcon />
            <span class="flex-1 min-w-0 text-zinc-900 text-[13px] font-semibold truncate">{{ project.name }}</span>
            <span :class="['w-2 h-2 rounded-full shrink-0', project.online ? 'bg-success' : 'bg-zinc-400']" />
        </div>

        <div v-if="project.agents.length > 0" class="flex items-center gap-1">
            <span
                v-for="(a, i) in project.agents"
                :key="i"
                class="w-6 h-6 rounded shrink-0 text-white text-[10px] font-bold flex items-center justify-center font-mono"
                :style="{ background: avatarColor(a.agentType, a.initials) }"
            >{{ a.initials }}</span>
            <span
                v-if="project.extraAgents > 0"
                class="w-6 h-6 rounded shrink-0 bg-canvas border border-stroke text-zinc-500 text-[10px] font-bold flex items-center justify-center font-mono"
            >+{{ project.extraAgents }}</span>
        </div>

        <div class="flex items-center justify-between gap-2 text-[11px] text-zinc-400 font-mono">
            <span class="truncate">{{ summary }}</span>
            <span class="shrink-0">{{ project.lastActivity }}</span>
        </div>
    </button>
</template>
