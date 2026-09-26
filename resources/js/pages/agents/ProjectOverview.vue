<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import useWorkspaces from '@/queries/workspacesQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import AgentCard from './AgentCard.vue'
import { PLACEHOLDER } from './presentation'
import { useAgentActions } from './useAgentActions'

const props = defineProps<{ project: Project }>()

const layout = useAppLayoutStore()
const { workspaces } = useWorkspaces()
const { agents, isPending, adoptPending, isRunning, open, restart, adopt } = useAgentActions(() => props.project)

const workspaceName = computed(() => workspaces.value.find(w => w.id === props.project.workspace_id)?.name ?? null)
const activeCount = computed(() => agents.value.filter(a => isRunning(a.id)).length)

const pillClass = 'inline-flex items-center gap-1.5 bg-surface border border-stroke rounded-full py-[5px] px-3 text-[12.5px] text-zinc-700 whitespace-nowrap'
</script>

<template>
    <div class="flex-1 overflow-y-auto bg-[#f7f7f5]">
        <div class="max-w-[1180px] pt-[26px] px-[34px] pb-10">
            <!-- Breadcrumb -->
            <div class="text-[13px] mb-3.5">
                <template v-if="workspaceName">
                    <span class="text-zinc-500">{{ workspaceName }}</span>
                    <span class="text-zinc-400 my-0 mx-[7px]">/</span>
                </template>
                <span class="text-zinc-900 font-semibold">{{ project.name }}</span>
            </div>

            <!-- Header row: title + description + pills, and New Agent button -->
            <div class="flex items-start gap-5">
                <div class="flex-1 min-w-0">
                    <h1 class="m-0 text-[30px] font-extrabold tracking-[-0.02em] text-zinc-900">{{ project.name }}</h1>

                    <p v-if="project.system_prompt" class="mt-2 mb-0 mx-0 text-[15px] leading-normal text-zinc-500 max-w-[680px]">
                        {{ project.system_prompt }}
                    </p>

                    <div class="flex flex-wrap gap-2 mt-4">
                        <span :class="pillClass" data-testid="active-count">
                            <Icon name="check" :size="13" :color="color.success" />
                            {{ activeCount }} active
                        </span>
                        <span :class="pillClass">
                            <Icon name="git-merge" :size="13" :color="color.textMuted" />
                            {{ PLACEHOLDER }}
                        </span>
                        <span :class="pillClass">{{ agents.length }} agents</span>
                    </div>
                </div>

                <button
                    type="button"
                    class="shrink-0 flex items-center gap-[7px] bg-[#111318] border-0 rounded-lg text-white text-[13.5px] font-semibold py-2.5 px-4 cursor-pointer transition-opacity duration-100 hover:opacity-[0.88]"
                    @click="layout.migratingModal = 'New agent'"
                >
                    <Icon name="plus" :size="13" />
                    New Agent
                </button>
            </div>

            <div
                v-if="agents.length === 0"
                class="mt-7 p-12 text-center bg-surface border border-dashed border-stroke rounded-[16px]"
            >
                <p class="m-0 text-[14px] text-zinc-500">
                    {{ isPending ? 'Loading agents…' : 'No agents yet. Create one to get started.' }}
                </p>
            </div>
            <div v-else class="mt-[26px] grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-[22px]">
                <AgentCard
                    v-for="agent in agents"
                    :key="agent.id"
                    :agent="agent"
                    :running="isRunning(agent.id)"
                    :status-line="agent.description"
                    :adopt-pending="adoptPending"
                    :stats="{
                        runtime: PLACEHOLDER,
                        provider: agent.provider,
                        model: agent.model,
                        branch: PLACEHOLDER,
                        usage: PLACEHOLDER,
                    }"
                    @open="open(agent)"
                    @restart="restart(agent)"
                    @adopt="adopt(agent)"
                />
            </div>
        </div>
    </div>
</template>
