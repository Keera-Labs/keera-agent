<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { FitAddon } from '@xterm/addon-fit'
import DotsIndicator from '@/components/ui/DotsIndicator.vue'
import { attachTerminal, makeTerminal, type Session } from '@/composables/useTerminalSessions'
import CommandForm from './CommandForm.vue'
import CommandRow from './CommandRow.vue'
import Icon from './Icon.vue'
import type { Command } from './types'

// Create/edit/delete shell commands and run each in an interactive PTY streamed over
// the command WebSocket. Live status is driven by the socket lifecycle.
const props = defineProps<{ projectId: number; projectSlug: string; initialCommands: Command[] }>()

const commands = ref<Command[]>([...props.initialCommands])
const showForm = ref(false)
const selectedId = ref<number | null>(null)

// Kept out of Vue state: proxying xterm internals breaks it.
const sessions = new Map<number, Session>()
const containers = new Map<number, HTMLElement>()

watch(() => props.initialCommands, next => { commands.value = [...next] })

const outputCmd = computed(() => commands.value.find(c => c.id === selectedId.value) ?? null)
const runningCount = computed(() => commands.value.filter(c => c.status === 'running').length)

onBeforeUnmount(() => {
    sessions.forEach(({ term, ws, observer }) => {
        observer.disconnect()
        term.dispose()
        ws.close()
    })
    sessions.clear()
})

function setContainer(id: number, el: unknown) {
    if (el instanceof HTMLElement) containers.set(id, el)
    else containers.delete(id)
}

function patchCommand(id: number, patch: Partial<Command>) {
    commands.value = commands.value.map(c => (c.id === id ? { ...c, ...patch } : c))
}

async function handleCreate(label: string, command: string): Promise<string | null> {
    try {
        const res = await fetch(`/api/projects/${props.projectId}/commands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label, command }),
        })
        const data = await res.json()
        if (!res.ok) return data.error ?? 'Failed'
        commands.value = [...commands.value, data as Command]
        showForm.value = false
        return null
    } catch {
        return 'Network error'
    }
}

async function handleUpdate(c: Command, label: string, command: string): Promise<boolean> {
    const res = await fetch(`/api/commands/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, command }),
    })
    const data = await res.json()
    if (!res.ok) return false
    patchCommand(c.id, data)
    return true
}

// The output panel (and so each xterm container) unmounts when it is closed, so a
// live terminal is re-parented into the fresh container whenever it is shown again.
function showSession(session: Session, container: HTMLElement) {
    attachTerminal(session.term, container)
    session.fitAddon.fit()
    session.observer.disconnect()
    session.observer.observe(container)
    session.term.focus()
}

async function handleSelect(c: Command) {
    selectedId.value = c.id
    await nextTick()
    const session = sessions.get(c.id)
    const container = containers.get(c.id)
    if (session && container) showSession(session, container)
}

async function handleRun(c: Command) {
    selectedId.value = c.id
    await nextTick()
    const container = containers.get(c.id)
    if (!container) return

    const existing = sessions.get(c.id)
    if (existing) {
        showSession(existing, container)
        return
    }

    const term = makeTerminal()
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    const textarea = container.querySelector('textarea')
    if (textarea) {
        textarea.setAttribute('autocomplete', 'off')
        textarea.setAttribute('autocorrect', 'off')
        textarea.setAttribute('autocapitalize', 'none')
        textarea.setAttribute('spellcheck', 'false')
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/${props.projectSlug}/command-ws/${c.id}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        patchCommand(c.id, { status: 'running' })
    }
    ws.onmessage = e => {
        if (typeof e.data !== 'string') term.write(new Uint8Array(e.data as ArrayBuffer))
    }
    ws.onclose = () => {
        term.write('\r\n\x1b[31m[exited]\x1b[0m\r\n')
        patchCommand(c.id, { status: 'stopped', pid: null })
    }
    term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
    term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    })
    term.focus()

    const observer = new ResizeObserver(() => fitAddon.fit())
    observer.observe(container)

    sessions.set(c.id, { term, ws, fitAddon, observer })
}

async function handleStop(c: Command) {
    sessions.get(c.id)?.ws.close()
    await fetch(`/api/commands/${c.id}/stop`, { method: 'POST' })
    patchCommand(c.id, { status: 'stopped', pid: null })
}

async function handleDelete(c: Command) {
    const session = sessions.get(c.id)
    if (session) {
        session.observer.disconnect()
        session.ws.close()
        session.term.dispose()
        sessions.delete(c.id)
    }
    await fetch(`/api/commands/${c.id}`, { method: 'DELETE' })
    commands.value = commands.value.filter(x => x.id !== c.id)
    if (selectedId.value === c.id) selectedId.value = null
}
</script>

<template>
    <div class="flex-1 flex flex-col overflow-hidden">
        <div class="py-2.5 px-5 border-b border-stroke flex items-center gap-2 shrink-0 bg-canvas">
            <Icon name="terminal" :size="13" class="text-zinc-500" />
            <span class="text-zinc-900 text-[13px] font-semibold flex-1">Commands</span>
            <span
                v-if="runningCount > 0"
                class="text-[10px] py-px px-[7px] rounded-lg bg-[rgba(63,185,80,0.1)] border border-[rgba(63,185,80,0.3)] text-success"
            >
                {{ runningCount }} running
            </span>
            <button
                :class="[
                    'border rounded-[5px] text-[11px] py-1 px-2.5 cursor-pointer flex items-center gap-[5px]',
                    showForm ? 'bg-surface border-stroke text-zinc-500' : 'bg-success border-success text-white',
                ]"
                @click="showForm = !showForm"
            >
                <template v-if="showForm">× Cancel</template>
                <template v-else>
                    <Icon name="plus" :size="10" />
                    New command
                </template>
            </button>
        </div>

        <CommandForm v-if="showForm" :on-create="handleCreate" @cancel="showForm = false" />

        <div class="flex-1 flex overflow-hidden">
            <div
                :class="[
                    'shrink-0 overflow-y-auto flex flex-col',
                    outputCmd ? 'w-[260px] border-r border-r-stroke' : 'w-full border-r-0',
                ]"
            >
                <div
                    v-if="commands.length === 0"
                    class="flex-1 flex flex-col items-center justify-center gap-3 py-10 px-6 text-center"
                >
                    <div class="w-12 h-12 rounded-full bg-surface border border-stroke flex items-center justify-center text-zinc-400">
                        <Icon name="terminal" :size="22" />
                    </div>
                    <div>
                        <p class="mt-0 mr-0 mb-1 ml-0 text-zinc-700 text-[13px] font-medium">No commands yet</p>
                        <p class="m-0 text-zinc-400 text-[12px] leading-normal">
                            Add build scripts, dev servers,<br />or any long-running process.
                        </p>
                    </div>
                    <button
                        class="bg-transparent border border-dashed border-stroke rounded text-zinc-500 text-[12px] py-1.5 px-3.5 cursor-pointer hover:border-accent hover:text-accent"
                        @click="showForm = true"
                    >
                        + Add your first command
                    </button>
                </div>
                <div v-else class="flex flex-col">
                    <CommandRow
                        v-for="c in commands"
                        :key="c.id"
                        :command="c"
                        :is-selected="outputCmd?.id === c.id"
                        :on-update="(label: string, cmd: string) => handleUpdate(c, label, cmd)"
                        @select="handleSelect(c)"
                        @run="handleRun(c)"
                        @stop="handleStop(c)"
                        @delete="handleDelete(c)"
                    />
                    <button
                        class="flex items-center gap-1.5 py-[9px] px-3.5 bg-transparent border-none text-zinc-400 text-[11px] cursor-pointer w-full text-left hover:text-zinc-500 hover:bg-surface"
                        @click="showForm = true"
                    >
                        <Icon name="plus" :size="10" />
                        Add command
                    </button>
                </div>
            </div>

            <div v-if="outputCmd" class="flex-1 flex flex-col overflow-hidden">
                <div class="pt-4 pr-5 pb-3.5 pl-5 border-b border-stroke shrink-0 bg-canvas">
                    <div class="flex items-center gap-2.5 mb-3">
                        <h2 class="m-0 text-zinc-900 text-[18px] font-bold font-mono tracking-[-0.01em]">/{{ outputCmd.label }}</h2>
                        <DotsIndicator v-if="outputCmd.status === 'running'" />
                        <span v-else class="text-[10px] text-zinc-400 font-mono">exited</span>
                        <div class="flex-1" />
                        <button
                            title="Close"
                            class="bg-transparent border-none text-zinc-400 cursor-pointer py-0 px-0.5 leading-none rounded-sm flex items-center hover:text-zinc-700"
                            @click="selectedId = null"
                        >
                            <Icon name="x" :size="14" />
                        </button>
                    </div>
                    <div>
                        <div class="text-zinc-400 text-[10px] font-bold uppercase tracking-[0.08em] mb-1.5">Shell</div>
                        <div class="bg-canvas rounded py-2 px-3 border border-stroke font-mono text-[12px] text-zinc-700 flex items-center gap-2 overflow-hidden">
                            <span class="text-success shrink-0">$</span>
                            <span class="truncate">{{ outputCmd.command }}</span>
                        </div>
                    </div>
                </div>

                <!-- One xterm container per command; only the selected one is visible. -->
                <div class="flex-1 relative bg-canvas overflow-hidden">
                    <div
                        v-for="c in commands"
                        :key="c.id"
                        :ref="el => setContainer(c.id, el)"
                        :class="['absolute inset-0 p-2 box-border', c.id === outputCmd.id ? 'block' : 'hidden']"
                        @click="sessions.get(c.id)?.term.focus()"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<style>
@keyframes cmd-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
</style>
