<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { Command, CommandRun } from '@/components/commands/types'
import { useViewedWorktree } from '@/composables/useViewedWorktree'
import { useCommandRuns, useCommands } from '@/queries/commandQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useCommandRunStore, type CommandTarget } from '@/stores/commandRunStore'
import { useProjectStore } from '@/stores/projectStore'

const layout = useAppLayoutStore()
const { activeAgentId, settingsSection } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())
const runs = useCommandRunStore()

const projectId = computed(() => activeProject.value?.id ?? null)
const worktreeAgentId = computed(() => {
    const agent = layout.agentHook.agents.value.find(a => a.id === activeAgentId.value)
    return agent && agent.agent_type !== 'pm' ? agent.id : null
})
const { path: worktree, place, branch, status, ready } = useViewedWorktree(projectId, worktreeAgentId)
const { data: commands } = useCommands(projectId)
const { data: commandRuns, refetch: refetchRuns } = useCommandRuns(projectId)

const open = ref(false)
const error = ref('')
const root = ref<HTMLElement | null>(null)

const runsHere = computed(() => {
    const byCommand = new Map<number, CommandRun>()
    for (const run of commandRuns.value ?? []) {
        if (run.command_id === null || run.worktree !== worktree.value || byCommand.has(run.command_id)) continue
        byCommand.set(run.command_id, run)
    }
    return byCommand
})
const runningCount = computed(() => [...runsHere.value.values()].filter(r => r.status === 'running').length)

const target = (): CommandTarget | null =>
    activeProject.value && ready.value
        ? { projectId: activeProject.value.id, projectSlug: activeProject.value.slug, worktree: worktree.value, place: place.value }
        : null

const isRunning = (command: Command) => runsHere.value.get(command.id)?.status === 'running'

function statusDotClass(command: Command) {
    const run = runsHere.value.get(command.id)
    if (run?.status === 'running') return 'bg-success'
    if (run?.status === 'exited' && run.exit_code !== 0) return 'bg-danger'
    if (run) return 'bg-zinc-400'
    return 'bg-transparent border border-zinc-300'
}

async function attempt(action: () => Promise<void>) {
    error.value = ''
    try {
        await action()
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Request failed'
    }
}

function start(command: Command) {
    const t = target()
    if (t) attempt(() => runs.run(command, t))
}

function stop(command: Command) {
    attempt(() => runs.stop(command.id, worktree.value))
}

function show(command: Command) {
    const t = target()
    if (!t) return
    runs.show(command, t)
    open.value = false
}

function manage() {
    settingsSection.value = 'commands'
    open.value = false
}

function onPointerDown(event: MouseEvent) {
    if (!root.value?.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') open.value = false
}

function listen(active: boolean) {
    if (active) {
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeydown)
    } else {
        document.removeEventListener('mousedown', onPointerDown)
        document.removeEventListener('keydown', onKeydown)
    }
}

watch(open, active => {
    listen(active)
    if (active) refetchRuns()
})
onBeforeUnmount(() => listen(false))

const iconButtonClass =
    'w-5 h-5 flex items-center justify-center rounded text-zinc-500 cursor-pointer hover:bg-black/[0.06] hover:text-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'
</script>

<template>
    <div v-if="activeProject" ref="root" class="relative shrink-0 flex items-center">
        <button
            type="button"
            data-testid="run-menu-button"
            :aria-expanded="open"
            :title="branch ? `Commands run in ${place} (${branch})` : `Commands run in ${place}`"
            class="h-6 flex items-center gap-1.5 px-2 rounded-md border border-stroke bg-white text-ui-12 text-zinc-600 cursor-pointer transition-colors hover:text-zinc-900 hover:border-zinc-300"
            @click="open = !open"
        >
            <Icon name="play" :size="11" />
            <span>Run</span>
            <span v-if="runningCount" data-testid="run-menu-count" class="text-ui-10 text-success">{{ runningCount }}</span>
            <span class="max-md:hidden text-zinc-400 truncate max-w-40">in: {{ place }}</span>
            <Icon name="chevron-down" :size="11" />
        </button>

        <div
            v-if="open"
            role="menu"
            aria-label="Run a command"
            class="absolute top-full right-0 mt-1 z-30 w-72 py-1 rounded-md bg-surface border border-stroke shadow-lg"
        >
            <div class="px-3 py-1 text-ui-10 text-zinc-400 truncate">
                in: {{ place }}<template v-if="branch"> · {{ branch }}</template>
            </div>
            <div v-if="status === 'missing'" data-testid="run-menu-no-worktree" class="px-3 py-1.5 text-ui-12 text-zinc-500">
                This agent has no worktree.
            </div>
            <div
                v-for="command in commands ?? []"
                :key="command.id"
                data-testid="run-menu-row"
                role="menuitem"
                class="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-black/[0.04]"
                @click="show(command)"
            >
                <span :data-status="runsHere.get(command.id)?.status ?? 'idle'" :class="['w-2 h-2 rounded-full shrink-0', statusDotClass(command)]" />
                <span class="flex-1 min-w-0 truncate text-ui-12 text-zinc-800 font-mono">{{ command.label }}</span>
                <template v-if="isRunning(command)">
                    <button type="button" title="Rerun" aria-label="Rerun" :disabled="!ready" :class="iconButtonClass" @click.stop="start(command)">
                        <Icon name="rotate-cw" :size="11" />
                    </button>
                    <button type="button" title="Stop" aria-label="Stop" :class="iconButtonClass" @click.stop="stop(command)">
                        <Icon name="square" :size="10" />
                    </button>
                </template>
                <button v-else type="button" title="Run" aria-label="Run" :disabled="!ready" :class="iconButtonClass" @click.stop="start(command)">
                    <Icon name="play" :size="11" />
                </button>
            </div>
            <div v-if="(commands ?? []).length === 0" class="px-3 py-1.5 text-ui-12 text-zinc-400">No commands yet</div>
            <div v-if="error" data-testid="run-menu-error" class="px-3 py-1 text-ui-11 text-danger">{{ error }}</div>
            <div class="my-1 border-t border-stroke" />
            <button type="button" class="w-full text-left px-3 py-1.5 text-ui-12 text-zinc-600 cursor-pointer hover:bg-black/[0.04]" @click="manage">
                + Add command…
            </button>
            <button type="button" class="w-full flex items-center gap-1.5 text-left px-3 py-1.5 text-ui-12 text-zinc-600 cursor-pointer hover:bg-black/[0.04]" @click="manage">
                <Icon name="settings" :size="11" /> Manage
            </button>
        </div>
    </div>
</template>
