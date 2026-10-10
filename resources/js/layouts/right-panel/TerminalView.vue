<script setup lang="ts">
import { RotateCw, Square, Terminal, Trash2, X } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useCommandRuns } from '@/queries/commandQuery'
import { tabKeyOfRun, useCommandRunStore, type DockTab } from '@/stores/commandRunStore'
import { useProjectStore } from '@/stores/projectStore'
import { latestStarted } from './commands/commandRuns'

defineProps<{ visible: boolean }>()

const runs = useCommandRunStore()
const { tabs, activeKey } = storeToRefs(runs)
const { activeProject } = storeToRefs(useProjectStore())

const projectId = computed(() => activeProject.value?.id ?? null)
const { data: commandRuns } = useCommandRuns(projectId)

const projectTabs = computed(() => tabs.value.filter(t => t.projectId === projectId.value))
const current = computed(() => projectTabs.value.find(t => t.key === activeKey.value) ?? projectTabs.value[0] ?? null)
const error = ref('')

const latestRun = (tab: DockTab) => latestStarted((commandRuns.value ?? []).filter(r => tabKeyOfRun(r) === tab.key))
const isRunning = (tab: DockTab) => latestRun(tab)?.status === 'running'

async function attempt(action: () => Promise<void>) {
    error.value = ''
    try {
        await action()
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Request failed'
    }
}

function rerun(tab: DockTab) {
    if (tab.commandId !== null) attempt(() => runs.run({ id: tab.commandId!, label: tab.label }, tab))
    else if (tab.command) attempt(() => runs.runAdhoc(tab.command!, tab))
}

function stop(tab: DockTab) {
    const run = latestRun(tab)
    if (run) attempt(() => runs.stopRun(tab.projectId, run))
}

const actionClass = 'shrink-0 h-6 px-1.5 flex items-center gap-1 rounded-md text-ui-12 text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-900'
</script>

<template>
    <section v-show="visible" data-testid="terminal-view" aria-label="Command output" class="flex-1 min-h-0 min-w-0 flex flex-col">
        <div v-if="current" class="shrink-0 flex items-center gap-1 px-3 pt-3 pb-2">
            <div class="flex-1 min-w-0 flex flex-wrap items-center gap-1">
                <div
                    v-for="tab in projectTabs"
                    :key="tab.key"
                    data-testid="command-dock-tab"
                    :title="`${tab.command ?? tab.label} @ ${tab.place}`"
                    :class="[
                        'max-w-full min-w-0 h-7 flex items-center gap-1.5 pl-2 pr-1 rounded-md text-ui-12 font-mono cursor-pointer',
                        tab.key === current.key ? 'bg-surface border border-stroke text-zinc-900 shadow-sm' : 'border border-transparent text-zinc-500 hover:text-zinc-800 hover:bg-black/[0.03]',
                    ]"
                    @click="activeKey = tab.key"
                >
                    <span
                        data-testid="command-dock-tab-dot"
                        :class="['shrink-0 w-1.5 h-1.5 rounded-full', isRunning(tab) ? 'bg-orange-500 animate-pulse' : 'bg-zinc-300']"
                    />
                    <span class="min-w-0 truncate">{{ tab.label }}</span>
                    <button
                        type="button"
                        title="Close tab"
                        aria-label="Close tab"
                        class="shrink-0 w-4 h-4 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-800"
                        @click.stop="runs.closeTab(tab.key)"
                    >
                        <X :size="10" />
                    </button>
                </div>
            </div>
        </div>
        <div v-if="current" class="shrink-0 flex items-center gap-1 px-3 pb-2">
            <span class="flex-1 min-w-0 truncate text-ui-11 text-zinc-400" :title="current.place">in {{ current.place }}</span>
            <button v-if="isRunning(current)" type="button" data-testid="command-dock-stop" :class="[actionClass, 'text-red-600 hover:text-red-700']" @click="stop(current)">
                <Square :size="10" fill="currentColor" /> Stop
            </button>
            <button type="button" data-testid="command-dock-rerun" :class="actionClass" @click="rerun(current)">
                <RotateCw :size="11" /> Rerun
            </button>
            <button type="button" data-testid="command-dock-clear" :class="actionClass" @click="runs.clear(current.key)">
                <Trash2 :size="11" /> Clear
            </button>
        </div>
        <p v-if="error" role="alert" class="shrink-0 px-3 pb-2 text-ui-12 text-danger break-words">{{ error }}</p>

        <div
            v-if="!current"
            data-testid="terminal-empty"
            class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center text-ui-13 text-zinc-400"
        >
            <Terminal :size="20" />
            <span>Command output shows here. Run one from Commands.</span>
        </div>
        <div :class="['relative min-h-0 overflow-hidden mx-3 mb-3 rounded-lg border border-stroke bg-[#f6f8fa]', current ? 'flex-1' : 'hidden']">
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
