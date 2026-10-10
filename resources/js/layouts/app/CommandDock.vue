<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useCommandRuns } from '@/queries/commandQuery'
import { useCommandRunStore, type DockTab } from '@/stores/commandRunStore'
import { useProjectStore } from '@/stores/projectStore'

const runs = useCommandRunStore()
const { tabs, activeKey, dockOpen } = storeToRefs(runs)
const { activeProject } = storeToRefs(useProjectStore())

const projectId = computed(() => activeProject.value?.id ?? null)
const { data: commandRuns } = useCommandRuns(projectId)

// Every tab keeps its terminal host mounted; only the active project's tabs are listed.
const projectTabs = computed(() => tabs.value.filter(t => t.projectId === projectId.value))
const current = computed(() => projectTabs.value.find(t => t.key === activeKey.value) ?? projectTabs.value[0] ?? null)
const visible = computed(() => dockOpen.value && current.value !== null)
const error = ref('')

function statusOf(tab: DockTab) {
    return commandRuns.value?.find(r => r.command_id === tab.commandId && r.worktree === tab.worktree)?.status ?? null
}

async function attempt(action: () => Promise<void>) {
    error.value = ''
    try {
        await action()
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Request failed'
    }
}

function rerun(tab: DockTab) {
    attempt(() => runs.run({ id: tab.commandId, label: tab.label }, tab))
}

function stop(tab: DockTab) {
    attempt(() => runs.stop(tab.commandId, tab.worktree))
}

const iconButtonClass = 'h-6 px-1.5 flex items-center gap-1 rounded text-ui-11 text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-900'
</script>

<template>
    <section
        v-show="visible"
        data-testid="command-dock"
        aria-label="Commands"
        class="shrink-0 h-64 flex flex-col border-t border-stroke bg-canvas"
    >
        <div class="h-8 shrink-0 flex items-center gap-1 px-2 border-b border-stroke">
            <span class="text-ui-11 font-semibold text-zinc-500 uppercase tracking-wide mr-1">Commands</span>
            <div class="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto">
                <div
                    v-for="tab in projectTabs"
                    :key="tab.key"
                    data-testid="command-dock-tab"
                    :class="[
                        'shrink-0 h-6 flex items-center gap-1.5 pl-2 pr-1 rounded text-ui-12 cursor-pointer font-mono',
                        tab.key === current?.key ? 'bg-white border border-stroke text-zinc-900' : 'text-zinc-500 hover:text-zinc-800',
                    ]"
                    @click="activeKey = tab.key"
                >
                    <span :class="['w-1.5 h-1.5 rounded-full', statusOf(tab) === 'running' ? 'bg-success' : 'bg-zinc-300']" />
                    <span>{{ tab.label }} @ {{ tab.place }}</span>
                    <button
                        type="button"
                        title="Close tab"
                        aria-label="Close tab"
                        class="w-4 h-4 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-800"
                        @click.stop="runs.closeTab(tab.key)"
                    >
                        <Icon name="x" :size="10" />
                    </button>
                </div>
            </div>
            <span v-if="error" class="text-ui-11 text-danger truncate max-w-60">{{ error }}</span>
            <template v-if="current">
                <button
                    v-if="statusOf(current) === 'running'"
                    type="button"
                    data-testid="command-dock-stop"
                    :class="iconButtonClass"
                    @click="stop(current)"
                >
                    <Icon name="square" :size="10" /> Stop
                </button>
                <button type="button" data-testid="command-dock-rerun" :class="iconButtonClass" @click="rerun(current)">
                    <Icon name="rotate-cw" :size="11" /> Rerun
                </button>
                <button type="button" data-testid="command-dock-clear" :class="iconButtonClass" @click="runs.clear(current.key)">
                    <Icon name="trash-2" :size="11" /> Clear
                </button>
            </template>
            <button type="button" title="Hide commands" aria-label="Hide commands" :class="iconButtonClass" @click="dockOpen = false">
                <Icon name="chevron-down" :size="12" />
            </button>
        </div>
        <div class="flex-1 relative overflow-hidden bg-[#f6f8fa]">
            <div
                v-for="tab in tabs"
                :key="tab.key"
                :ref="el => runs.setHost(tab.key, el as HTMLElement | null)"
                :class="['absolute inset-0 terminal-host', tab.key === current?.key ? 'block' : 'hidden']"
                @click="runs.focusTerminal(tab.key)"
            />
        </div>
    </section>
</template>
