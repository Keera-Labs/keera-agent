import { useQueryCache } from '@pinia/colada'
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { Command, CommandRun } from '@/components/commands/types'
import { createPanelSession, mountPanelSession } from '@/composables/panelTerminal'
import { reportSize, socketMessageHandler, type Session } from '@/composables/useTerminalSessions'
import { COMMAND_RUNS_QUERY_KEY, startAdhocRun, startCommandRun, stopCommandRun, stopRunById } from '@/queries/commandQuery'

type CommandRef = Pick<Command, 'id' | 'label'>

export type CommandTarget = { projectId: number; projectSlug: string; worktree: string | null; place: string }

export interface DockTab {
    key: string
    projectId: number
    projectSlug: string
    commandId: number | null
    runId: string | null
    label: string
    command: string | null
    worktree: string | null
    place: string
    attached: boolean
}

export const dockTabKey = (commandId: number, worktree: string | null) => `${commandId}@${worktree ?? ''}`
const runTabKey = (runId: string) => `run:${runId}`

export const tabKeyOfRun = (run: Pick<CommandRun, 'id' | 'command_id' | 'worktree'>) =>
    run.command_id !== null ? dockTabKey(run.command_id, run.worktree) : run.id ? runTabKey(run.id) : null

const sessions = new Map<string, Session>()
const hosts = new Map<string, HTMLElement>()

function socketUrl(tab: DockTab) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    if (tab.commandId === null) return `${protocol}//${location.host}/${tab.projectSlug}/command-run-ws/${tab.runId}`
    const query = tab.worktree ? `?${new URLSearchParams({ worktree: tab.worktree })}` : ''
    return `${protocol}//${location.host}/${tab.projectSlug}/command-ws/${tab.commandId}${query}`
}

function detach(session: Session) {
    if (!session.ws) return
    session.ws.onclose = null
    session.ws.close()
}

export const useCommandRunStore = defineStore('commandRuns', () => {
    const queryCache = useQueryCache()
    const tabs = ref<DockTab[]>([])
    const activeKey = ref<string | null>(null)
    const outputOpen = ref(false)
    const selectedWorktrees = reactive<Record<number, string | null>>({})

    const activeTab = computed(() => tabs.value.find(t => t.key === activeKey.value) ?? null)

    const refreshRuns = () => queryCache.invalidateQueries({ key: COMMAND_RUNS_QUERY_KEY })

    type TabSource = Pick<DockTab, 'key' | 'commandId' | 'runId' | 'label' | 'command'>

    function ensureTab(source: TabSource, target: CommandTarget): DockTab {
        let tab = tabs.value.find(t => t.key === source.key)
        if (!tab) {
            tabs.value.push({
                ...source,
                projectId: target.projectId,
                projectSlug: target.projectSlug,
                worktree: target.worktree,
                place: target.place,
                attached: false,
            })
            tab = tabs.value[tabs.value.length - 1]
        }
        return tab
    }

    const savedSource = (command: CommandRef, target: CommandTarget): TabSource => ({
        key: dockTabKey(command.id, target.worktree),
        commandId: command.id,
        runId: null,
        label: command.label,
        command: null,
    })

    const adhocSource = (run: CommandRun & { id: string }, text: string): TabSource => ({
        key: runTabKey(run.id),
        commandId: null,
        runId: run.id,
        label: run.label ?? text,
        command: run.command ?? text,
    })

    function mountSession(key: string, session: Session) {
        const host = hosts.get(key)
        if (host) mountPanelSession(session, host)
    }

    function connect(tab: DockTab) {
        let session = sessions.get(tab.key)
        if (session) {
            detach(session)
            session.term.reset()
            session.reportedSize = undefined
        } else {
            session = createPanelSession()
            sessions.set(tab.key, session)
            mountSession(tab.key, session)
        }
        const current = session
        const ws = new WebSocket(socketUrl(tab))
        ws.binaryType = 'arraybuffer'
        current.ws = ws
        ws.onopen = () => reportSize(current)
        const handleMessage = socketMessageHandler(() => current, { onEvent: () => {} })
        ws.onmessage = e => handleMessage(e.data as string | ArrayBuffer)
        ws.onclose = () => {
            const live = tabs.value.find(t => t.key === tab.key)
            if (live) live.attached = false
            refreshRuns()
        }
        tab.attached = true
    }

    function focus(tab: DockTab, reveal = true) {
        activeKey.value = tab.key
        if (reveal) outputOpen.value = true
    }

    function showTab(source: TabSource, target: CommandTarget) {
        const tab = ensureTab(source, target)
        focus(tab)
        if (!tab.attached) connect(tab)
    }

    function show(command: CommandRef, target: CommandTarget) {
        showTab(savedSource(command, target), target)
    }

    function showAdhoc(run: CommandRun, target: CommandTarget) {
        if (run.id) showTab(adhocSource({ ...run, id: run.id }, run.command ?? run.label ?? ''), target)
    }

    async function run(command: CommandRef, target: CommandTarget, reveal = true) {
        await startCommandRun(command.id, target.worktree)
        refreshRuns()
        const tab = ensureTab(savedSource(command, target), target)
        focus(tab, reveal)
        connect(tab)
    }

    async function runAdhoc(text: string, target: CommandTarget, reveal = true) {
        const started = await startAdhocRun(target.projectId, text, target.worktree)
        refreshRuns()
        if (!started.id) return
        const tab = ensureTab(adhocSource({ ...started, id: started.id }, text), target)
        focus(tab, reveal)
        connect(tab)
    }

    async function stop(commandId: number, worktree: string | null) {
        await stopCommandRun(commandId, worktree)
        refreshRuns()
    }

    async function stopRun(projectId: number, run: CommandRun) {
        if (run.command_id !== null) await stopCommandRun(run.command_id, run.worktree)
        else if (run.id) await stopRunById(projectId, run.id)
        refreshRuns()
    }

    function clear(key: string) {
        sessions.get(key)?.term.clear()
    }

    function closeTab(key: string) {
        const session = sessions.get(key)
        if (session) {
            detach(session)
            session.observer.disconnect()
            session.term.dispose()
            sessions.delete(key)
        }
        tabs.value = tabs.value.filter(t => t.key !== key)
        if (activeKey.value === key) activeKey.value = tabs.value[tabs.value.length - 1]?.key ?? null
        if (tabs.value.length === 0) outputOpen.value = false
    }

    function forgetCommand(commandId: number) {
        for (const tab of tabs.value.filter(t => t.commandId === commandId)) closeTab(tab.key)
    }

    function setHost(key: string, el: HTMLElement | null) {
        if (!el) {
            hosts.delete(key)
            return
        }
        hosts.set(key, el)
        const session = sessions.get(key)
        if (session) mountSession(key, session)
    }

    function focusTerminal(key: string) {
        sessions.get(key)?.term.focus()
    }

    return {
        tabs,
        activeKey,
        activeTab,
        outputOpen,
        selectedWorktrees,
        show,
        showAdhoc,
        run,
        runAdhoc,
        stop,
        stopRun,
        clear,
        closeTab,
        forgetCommand,
        setHost,
        focusTerminal,
    }
})
