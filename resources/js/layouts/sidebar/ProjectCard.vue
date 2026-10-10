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
const expanded = computed(() => props.agents.length > 0 && !props.collapsed)
</script>

<template>
    <div
        data-testid="project-card"
        :data-color="color.name"
        :class="['rounded-xl p-1', color.tint, props.active && 'ring-1 ring-inset ring-black/[0.08]']"
    >
        <ProjectItem :project="props.project" :color="color" :active="props.active" :status="props.status">
            <template v-if="props.agents.length > 0" #toggle>
                <button
                    type="button"
                    data-testid="project-collapse"
                    :aria-expanded="!props.collapsed"
                    :aria-label="props.collapsed ? 'Show agents' : 'Hide agents'"
                    class="shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-zinc-500 cursor-pointer hover:bg-black/[0.06] hover:text-zinc-800"
                    @click.stop="$emit('toggle')"
                    @keydown.enter.stop
                >
                    <Icon
                        name="chevron-right"
                        :size="13"
                        :class="['transition-transform duration-150', expanded && 'rotate-90']"
                    />
                </button>
            </template>
            <template v-if="props.agents.length > 0" #badge>
                <span data-testid="project-count" class="shrink-0 text-ui-12 tabular-nums text-zinc-500">
                    {{ props.agents.length }}
                </span>
            </template>
        </ProjectItem>

        <ul
            v-if="expanded"
            data-testid="project-agents"
            class="list-none m-0 mt-0.5 pl-4 pb-0.5 flex flex-col gap-0.5"
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
