<script setup lang="ts">
import { Check, Pencil, Play, Plus, Search, Square, SquareTerminal, Trash2, X } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CommandForm from '@/components/commands/CommandForm.vue'
import type { Command, CommandRun } from '@/components/commands/types'
import { useCommandCrud } from '@/composables/useCommandCrud'
import { relativeTime } from '@/utils/relativeTime'
import { useCommandRuns, useCommands } from '@/queries/commandQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useCommandRunStore, type CommandTarget } from '@/stores/commandRunStore'
import { usePanelWorktree } from '../usePanelWorktree'
import { duration, recentRuns, succeeded } from './commandRuns'

const props = defineProps<{ visible: boolean }>()

const { settingsSection } = storeToRefs(useAppLayoutStore())
const runs = useCommandRunStore()
const { tabs, outputOpen } = storeToRefs(runs)

const { activeProject, projectId, path: worktree, place, branch, status, ready } = usePanelWorktree()
const { data: commands } = useCommands(projectId)
const { data: commandRuns } = useCommandRuns(projectId)
const crud = useCommandCrud(() => projectId.value ?? 0)

const query = ref('')
const error = ref('')
const creating = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const now = ref(Date.now())

const commandById = computed(() => new Map((commands.value ?? []).map(c => [c.id, c])))
const runsHere = computed(() => (commandRuns.value ?? []).filter(r => r.worktree === worktree.value))
const live = computed(() => runsHere.value.filter(r => r.status === 'running'))
const recent = computed(() => recentRuns(runsHere.value))
const runningIds = computed(() => new Set(live.value.map(r => r.command_id)))
const ranIds = computed(() => new Set(runsHere.value.map(r => r.command_id)))
const outputCount = computed(() => tabs.value.filter(t => t.projectId === projectId.value).length)

const needle = computed(() => query.value.trim().toLowerCase())
const saved = computed(() => (commands.value ?? []).filter(c =>
    !needle.value || c.label.toLowerCase().includes(needle.value) || c.command.toLowerCase().includes(needle.value)))
const exactMatch = computed(() => (commands.value ?? []).find(c =>
    c.label.toLowerCase() === needle.value || c.command.toLowerCase() === needle.value))

const savedOf = (run: CommandRun) => (run.command_id !== null ? commandById.value.get(run.command_id) : undefined)
const runName = (run: CommandRun) => run.label ?? savedOf(run)?.label ?? run.command ?? 'Command'
const runText = (run: CommandRun) => run.command ?? savedOf(run)?.command ?? ''
const liveRunOf = (command: Command) => live.value.find(r => r.command_id === command.id)
const ago = (iso: string) => {
    const rel = relativeTime(iso, now.value)
    return rel === 'now' ? 'just now' : `${rel} ago`
}

function recentMeta(run: CommandRun) {
    const when = ago(run.ended_at ?? run.started_at)
    if (succeeded(run)) return run.duration_ms != null ? `${duration(run.duration_ms)} · ${when}` : when
    if (run.status === 'stopped') return `stopped · ${when}`
    return `exit ${run.exit_code ?? '?'} · ${when}`
}

const target = (): CommandTarget | null =>
    activeProject.value && ready.value
        ? { projectId: activeProject.value.id, projectSlug: activeProject.value.slug, worktree: worktree.value, place: place.value }
        : null

async function attempt(action: () => Promise<unknown>) {
    error.value = ''
    try {
        await action()
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Request failed'
    }
}

function start(command: Command) {
    const t = target()
    if (t) attempt(() => runs.run(command, t, false))
}

function submit() {
    const text = query.value.trim()
    const t = target()
    if (!text || !t) return
    const command = exactMatch.value
    attempt(async () => {
        await (command ? runs.run(command, t, false) : runs.runAdhoc(text, t))
        query.value = ''
    })
}

function showOutput(command: Command) {
    const t = target()
    if (t) runs.show(command, t)
}

function openOutput(run: CommandRun) {
    const t = target()
    if (!t) return
    const command = savedOf(run)
    if (command) runs.show(command, t)
    else runs.showAdhoc(run, t)
}

function stop(command: Command) {
    const run = liveRunOf(command)
    if (run && projectId.value !== null) attempt(() => runs.stopRun(projectId.value!, run))
}

async function create(label: string, command: string) {
    const failure = await crud.create(label, command)
    if (!failure) creating.value = false
    return failure
}

function remove(command: Command) {
    attempt(async () => {
        const failure = await crud.remove(command)
        if (failure) throw new Error(failure)
    })
}

function onKeydown(e: KeyboardEvent) {
    if (!props.visible || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || document.querySelector('[role="dialog"]')) return
    e.preventDefault()
    searchInput.value?.focus()
}

let clockTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    window.addEventListener('keydown', onKeydown, { capture: true })
    clockTimer = setInterval(() => { now.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown, { capture: true })
    clearInterval(clockTimer)
})

const sectionClass = 'flex items-center gap-2 px-1 pb-1.5 text-ui-11 font-semibold uppercase tracking-[0.06em] text-zinc-500'
const iconButton = 'shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 cursor-pointer hover:text-zinc-800 hover:bg-black/[0.05] disabled:opacity-40 disabled:cursor-not-allowed'
</script>

<template>
    <section v-show="visible" data-testid="commands-view" aria-label="Commands" class="flex-1 min-h-0 min-w-0 flex flex-col">
        <form class="shrink-0 px-3 pt-3 pb-2" @submit.prevent="submit">
            <label class="flex items-center gap-2 h-9 px-2.5 rounded-lg border border-stroke bg-surface focus-within:border-zinc-400">
                <Search :size="14" class="shrink-0 text-zinc-400" />
                <input
                    ref="searchInput"
                    v-model="query"
                    data-testid="commands-search"
                    type="text"
                    placeholder="Run a command or search saved…"
                    aria-label="Run a command or search saved commands"
                    class="flex-1 min-w-0 bg-transparent text-ui-13 outline-none placeholder:text-zinc-400"
                >
                <kbd class="shrink-0 px-1.5 rounded border border-stroke bg-canvas font-sans text-ui-11 text-zinc-500">⌘K</kbd>
            </label>
            <p v-if="needle && !exactMatch" data-testid="commands-adhoc-hint" class="mt-1.5 px-1 truncate text-ui-11 text-zinc-400">
                ↵ runs <span class="font-mono text-zinc-600">{{ query.trim() }}</span> once in {{ place }}
            </p>
        </form>

        <p v-if="status === 'missing'" data-testid="commands-no-worktree" class="shrink-0 px-4 pb-2 text-ui-12 text-zinc-500">
            This agent has no worktree.
        </p>
        <p v-if="error" role="alert" data-testid="commands-error" class="shrink-0 mx-3 mb-2 px-2 py-1.5 rounded-md bg-red-50 text-ui-12 text-danger break-words">
            {{ error }}
        </p>

        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3 flex flex-col gap-4">
            <div>
                <div :class="sectionClass">
                    <span class="flex-1">Saved</span>
                    <button
                        type="button"
                        data-testid="commands-new"
                        class="h-6 flex items-center gap-1 px-1.5 rounded-md normal-case tracking-normal font-medium text-ui-12 text-zinc-600 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-900"
                        @click="creating = !creating"
                    >
                        <component :is="creating ? X : Plus" :size="12" /> {{ creating ? 'Cancel' : 'New' }}
                    </button>
                </div>
                <div v-if="creating" class="mb-2 overflow-hidden rounded-lg border border-stroke">
                    <CommandForm :on-create="create" @cancel="creating = false" />
                </div>
                <ul class="flex flex-col">
                    <li
                        v-for="command in saved"
                        :key="command.id"
                        data-testid="saved-command"
                        class="group min-w-0 flex items-center gap-2 h-12 px-1 rounded-md hover:bg-black/[0.03]"
                    >
                        <button
                            type="button"
                            data-testid="saved-output"
                            :disabled="!ranIds.has(command.id)"
                            :title="ranIds.has(command.id) ? `Show output of ${command.label}` : command.command"
                            class="flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default"
                            @click="showOutput(command)"
                        >
                            <span class="block truncate text-ui-13 font-semibold text-zinc-900">{{ command.label }}</span>
                            <span class="block truncate font-mono text-ui-11 text-zinc-400">{{ command.command }}</span>
                        </button>
                        <button
                            type="button"
                            title="Edit commands"
                            :aria-label="`Edit ${command.label}`"
                            :class="[iconButton, 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100']"
                            @click="settingsSection = 'commands'"
                        >
                            <Pencil :size="12" />
                        </button>
                        <button
                            type="button"
                            title="Delete"
                            :aria-label="`Delete ${command.label}`"
                            :class="[iconButton, 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-600!']"
                            @click="remove(command)"
                        >
                            <Trash2 :size="12" />
                        </button>
                        <button
                            v-if="runningIds.has(command.id)"
                            type="button"
                            data-testid="saved-stop"
                            title="Stop"
                            :aria-label="`Stop ${command.label}`"
                            class="shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-red-200 bg-surface text-red-600 cursor-pointer hover:bg-red-50"
                            @click="stop(command)"
                        >
                            <Square :size="10" fill="currentColor" />
                        </button>
                        <button
                            type="button"
                            data-testid="saved-run"
                            :data-running="runningIds.has(command.id)"
                            :title="runningIds.has(command.id) ? 'Restart' : 'Run'"
                            :aria-label="`${runningIds.has(command.id) ? 'Restart' : 'Run'} ${command.label}`"
                            :disabled="!ready"
                            :class="[
                                'shrink-0 w-7 h-7 flex items-center justify-center rounded-md border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                                runningIds.has(command.id)
                                    ? 'border-orange-200 bg-orange-50 text-orange-600'
                                    : 'border-stroke bg-surface text-zinc-600 hover:text-zinc-900 hover:border-zinc-300',
                            ]"
                            @click="start(command)"
                        >
                            <Play :size="11" fill="currentColor" />
                        </button>
                    </li>
                </ul>
                <p v-if="!saved.length" class="px-1 py-2 text-ui-12 text-zinc-400">
                    {{ needle ? 'No saved command matches' : 'No saved commands yet' }}
                </p>
            </div>

            <div v-if="recent.length">
                <div :class="sectionClass"><span>Recent</span></div>
                <ul class="flex flex-col">
                    <li v-for="run in recent" :key="run.id ?? `${run.command_id}@${run.worktree}`">
                        <button
                            type="button"
                            data-testid="recent-run"
                            :data-ok="succeeded(run)"
                            class="w-full min-w-0 flex items-center gap-2 h-8 px-1 rounded-md text-left cursor-pointer hover:bg-black/[0.03]"
                            :title="`Show output of ${runText(run)}`"
                            @click="openOutput(run)"
                        >
                            <Check v-if="succeeded(run)" :size="13" class="shrink-0 text-emerald-600" />
                            <X v-else :size="13" class="shrink-0 text-red-500" />
                            <span class="flex-1 min-w-0 truncate font-mono text-ui-12 text-zinc-700">{{ runText(run) || runName(run) }}</span>
                            <span class="shrink-0 text-ui-11 tabular-nums text-zinc-400">{{ recentMeta(run) }}</span>
                        </button>
                    </li>
                </ul>
            </div>
        </div>
        <div class="shrink-0 flex items-center gap-2 pl-4 pr-3 py-1.5 border-t border-stroke">
            <p data-testid="commands-place" class="flex-1 min-w-0 truncate text-ui-11 text-zinc-400" :title="branch ? `${place} · ${branch}` : place">
                Runs in {{ place }}<template v-if="branch"> · <span class="font-mono">{{ branch }}</span></template>
            </p>
            <button
                v-if="outputCount"
                type="button"
                data-testid="commands-show-output"
                class="shrink-0 h-6 flex items-center gap-1 px-1.5 rounded-md text-ui-12 text-zinc-600 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-900"
                @click="outputOpen = true"
            >
                <SquareTerminal :size="12" /> Output <span class="tabular-nums text-zinc-400">{{ outputCount }}</span>
            </button>
        </div>
    </section>
</template>
