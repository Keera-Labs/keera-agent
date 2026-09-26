<script setup lang="ts">
import { computed } from 'vue'
import DotsIndicator from '@/components/ui/DotsIndicator.vue'
import { color } from '@/tokens'
import ProjectCard from './ProjectCard.vue'
import SectionHeader from './SectionHeader.vue'
import StatCard from './StatCard.vue'
import WorkingAgentCard from './WorkingAgentCard.vue'
import type { DashboardData } from './types'

const props = defineProps<{ data: DashboardData }>()

// The headline, the running indicator and the Active card all read stats.active so they can't disagree.
const activeCount = computed(() => props.data.stats.active)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
</script>

<template>
    <div class="flex-1 overflow-auto bg-canvas">
        <div class="max-w-[1200px] mx-auto pt-6 px-7 pb-10">
            <div class="flex items-start gap-3 mb-6">
                <div class="flex-1 min-w-0">
                    <div class="text-zinc-900 text-[22px] font-bold leading-[1.2]">
                        {{ data.workspaceName }}
                    </div>
                    <div class="text-zinc-500 text-[13px] mt-1">
                        {{ plural(activeCount, 'agent') }} working across {{ plural(data.projectCount, 'project') }}.
                    </div>
                </div>
                <span v-if="activeCount > 0" data-testid="dashboard-status" class="flex items-center gap-1.5 shrink-0 mt-0.5">
                    <DotsIndicator />
                    <span class="text-amber-700 text-[11px] font-mono">running</span>
                </span>
                <span v-else data-testid="dashboard-status" class="shrink-0 mt-0.5 text-zinc-400 text-[11px] font-mono">idle</span>
            </div>

            <div class="flex gap-3 mb-7">
                <StatCard label="Projects" :value="data.stats.projects" :dot="color.accent" />
                <StatCard label="Active" :value="data.stats.active" :dot="color.success" />
                <StatCard label="Waiting" :value="data.stats.waiting" :dot="color.warningBright" />
                <StatCard label="Queued" :value="data.stats.queued" :dot="color.textGhost" />
            </div>

            <div v-if="data.workingNow.length > 0" class="mb-8">
                <SectionHeader title="Working now" :count="data.workingNow.length" />
                <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                    <WorkingAgentCard v-for="agent in data.workingNow" :key="agent.id" :agent="agent" />
                </div>
            </div>

            <div>
                <SectionHeader title="Projects" :count="data.projects.length" />
                <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                    <ProjectCard v-for="project in data.projects" :key="project.id" :project="project" />
                </div>
            </div>
        </div>
    </div>
</template>
