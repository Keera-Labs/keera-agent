<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import type { AgentSummary } from '@/queries/agentSummariesQuery'
import type { Project } from '@/types/type'
import AgentRow from './AgentRow.vue'
import ProjectItem from './ProjectItem.vue'

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
</script>

<template>
    <div data-testid="project-card" :class="['rounded-lg', props.agents.length > 0 && 'bg-black/[0.03] pb-1']">
        <ProjectItem :project="props.project" :active="props.active" :status="props.status">
            <template v-if="props.agents.length > 0" #badge>
                <button
                    type="button"
                    data-testid="project-collapse"
                    :aria-expanded="!props.collapsed"
                    :aria-label="props.collapsed ? 'Show agents' : 'Hide agents'"
                    class="shrink-0 flex items-center gap-0.5 h-4 pl-1.5 pr-1 rounded bg-black/[0.06] text-[10.5px] tabular-nums text-zinc-500 cursor-pointer hover:bg-black/[0.1] hover:text-zinc-800"
                    @click.stop="$emit('toggle')"
                    @keydown.enter.stop
                >
                    {{ props.agents.length }}
                    <Icon :name="props.collapsed ? 'chevron-right' : 'chevron-down'" :size="10" />
                </button>
            </template>
        </ProjectItem>

        <ul
            v-if="props.agents.length > 0 && !props.collapsed"
            data-testid="project-agents"
            class="list-none m-0 mt-0.5 ml-[11px] mr-1 pl-1.5 border-l-2 border-black/[0.08] flex flex-col gap-px"
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
