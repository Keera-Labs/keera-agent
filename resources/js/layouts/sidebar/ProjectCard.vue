<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { AgentSummary } from '@/queries/agentSummariesQuery'
import type { Project } from '@/types/type'
import AgentRow from './AgentRow.vue'
import ProjectItem from './ProjectItem.vue'
import { projectColor } from './projectColor'

const props = defineProps<{
    project: Project
    agents: AgentSummary[]
    active: boolean
    activeAgentId: number | null
    status?: 'running' | 'done'
    collapsed: boolean
    now: number
}>()

defineEmits<{ toggle: []; selectAgent: [agent: AgentSummary] }>()

const color = computed(() => projectColor(props.project.id))
</script>

<template>
    <div data-testid="project-card" :data-color="color.name">
        <ProjectItem :project="props.project" :color="color" :active="props.active" :status="props.status">
            <template v-if="props.agents.length > 0" #badge>
                <button
                    type="button"
                    data-testid="project-collapse"
                    :aria-expanded="!props.collapsed"
                    :aria-label="props.collapsed ? 'Show agents' : 'Hide agents'"
                    class="shrink-0 flex items-center gap-0.5 h-5 pl-1.5 pr-1 rounded-md text-ui-11 font-semibold tabular-nums cursor-pointer hover:bg-black/10"
                    @click.stop="$emit('toggle')"
                    @keydown.enter.stop
                >
                    {{ props.agents.length }}
                    <!-- Points up while open, like a tab group's header, and flips once collapsed. -->
                    <Icon
                        name="chevron-down"
                        :size="12"
                        :class="['transition-transform duration-150', !props.collapsed && 'rotate-180']"
                    />
                </button>
            </template>
        </ProjectItem>

        <ul
            v-if="props.agents.length > 0 && !props.collapsed"
            data-testid="project-agents"
            :class="['list-none m-0 mt-1 mb-0.5 ml-1 pl-1 border-l-2 flex flex-col gap-px', color.border]"
        >
            <li v-for="agent in props.agents" :key="agent.id">
                <AgentRow
                    :agent="agent"
                    :active="props.active && agent.id === props.activeAgentId"
                    :now="props.now"
                    @select="$emit('selectAgent', agent)"
                />
            </li>
        </ul>
    </div>
</template>
