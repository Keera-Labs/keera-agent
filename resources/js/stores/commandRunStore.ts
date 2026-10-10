import { useQueryCache } from '@pinia/colada'
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { FitAddon } from '@xterm/addon-fit'
import type { Command } from '@/components/commands/types'
import {
    attachTerminal,
    makeTerminal,
    reportSize,
    socketMessageHandler,
    type Session,
} from '@/composables/useTerminalSessions'
import { COMMAND_RUNS_QUERY_KEY, startCommandRun, stopCommandRun } from '@/queries/commandQuery'

type CommandRef = Pick<Command, 'id' | 'label'>

export type CommandTarget = { projectId: number; projectSlug: string; worktree: string | null; place: string }

export interface DockTab {
    key: string
    projectId: number
    projectSlug: string
    commandId: number
    label: string
    worktree: string | null
    place: string
    attached: boolean
}

export const dockTabKey = (commandId: number, worktree: string | null) => `${commandId}@${worktree ?? ''}`

// xterm instances and sockets stay out of Vue state (proxying xterm breaks it) and in
// module scope, so a run's output view outlives any component that shows it.
const sessions = new Map<string, Session>()
const hosts = new Map<string, HTMLElement>()

function socketUrl(tab: DockTab) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const query = tab.worktree ? `?${new URLSearchParams({ worktree: tab.worktree })}` : ''
    return `${protocol}//${location.host}/${tab.projectSlug}/command-ws/${tab.commandId}${query}`
}

function createSession(): Session {
    const term = makeTerminal()
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    const session: Session = {
        term,
        fitAddon,
        ws: null as unknown as WebSocket,
        observer: new ResizeObserver(() => {
            fitAddon.fit()
            reportSize(session)
        }),
    }
    term.onData(data => {
        if (session.ws?.readyState === WebSocket.OPEN) session.ws.send(data)
    })
    term.onResize(() => reportSize(session))
    return session
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
    const dockOpen = ref(false)
    // The Commands page's worktree choice per project; null is the project root.
    const selectedWorktrees = reactive<Record<number, string | null>>({})

    const activeTab = computed(() => tabs.value.find(t => t.key === activeKey.value) ?? null)

    const refreshRuns = () => queryCache.invalidateQueries({ key: COMMAND_RUNS_QUERY_KEY })

    function ensureTab(command: CommandRef, target: CommandTarget): DockTab {
        const key = dockTabKey(command.id, target.worktree)
        let tab = tabs.value.find(t => t.key === key)
        if (!tab) {
            tabs.value.push({
                key,
                projectId: target.projectId,
                projectSlug: target.projectSlug,
                commandId: command.id,
                label: command.label,
                worktree: target.worktree,
                place: target.place,
                attached: false,
            })
            tab = tabs.value[tabs.value.length - 1]
        }
        return tab
    }

    function mountSession(key: string, session: Session) {
        const host = hosts.get(key)
        if (!host) return
        attachTerminal(session.term, host)
        session.observer.disconnect()
        session.observer.observe(host)
        session.fitAddon.fit()
        reportSize(session)
    }

    // A fresh socket replays the run's whole history, so the old screen is reset first.
    function connect(tab: DockTab) {
        let session = sessions.get(tab.key)
        if (session) {
            detach(session)
            session.term.reset()
            session.reportedSize = undefined
        } else {
            session = createSession()
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

    function focus(tab: DockTab) {
        activeKey.value = tab.key
        dockOpen.value = true
    }

    function show(command: CommandRef, target: CommandTarget) {
        const tab = ensureTab(command, target)
        focus(tab)
        if (!tab.attached) connect(tab)
    }

    async function run(command: CommandRef, target: CommandTarget) {
        await startCommandRun(command.id, target.worktree)
        refreshRuns()
        const tab = ensureTab(command, target)
        focus(tab)
        connect(tab)
    }

    async function stop(commandId: number, worktree: string | null) {
        await stopCommandRun(commandId, worktree)
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
        if (tabs.value.length === 0) dockOpen.value = false
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
        dockOpen,
        selectedWorktrees,
        show,
        run,
        stop,
        clear,
        closeTab,
        forgetCommand,
        setHost,
        focusTerminal,
    }
})
