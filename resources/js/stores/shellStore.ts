import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createPanelSession, mountPanelSession } from '@/composables/panelTerminal'
import { reportSize, socketMessageHandler, type Session } from '@/composables/useTerminalSessions'

export type ShellTarget = { projectSlug: string; worktree: string | null; place: string }

export interface Shell extends ShellTarget {
    key: string
    alive: boolean
}

export const shellKey = (target: Pick<ShellTarget, 'projectSlug' | 'worktree'>) => `${target.projectSlug}@${target.worktree ?? ''}`

function socketUrl(shell: Shell) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const query = shell.worktree ? `?${new URLSearchParams({ worktree: shell.worktree })}` : ''
    return `${protocol}//${location.host}/${shell.projectSlug}/shell-ws${query}`
}

export const useShellStore = defineStore('shells', () => {
    const shells = ref<Shell[]>([])
    const sessions = new Map<string, Session>()
    const hosts = new Map<string, HTMLElement>()

    function mount(key: string) {
        const session = sessions.get(key)
        const host = hosts.get(key)
        if (session && host) mountPanelSession(session, host)
    }

    function connect(shell: Shell) {
        let session = sessions.get(shell.key)
        if (session) {
            session.term.reset()
            session.reportedSize = undefined
        } else {
            session = createPanelSession()
            sessions.set(shell.key, session)
            mount(shell.key)
        }
        const current = session
        const ws = new WebSocket(socketUrl(shell))
        ws.binaryType = 'arraybuffer'
        current.ws = ws
        ws.onopen = () => reportSize(current)
        const handleMessage = socketMessageHandler(() => current, { onEvent: () => {} })
        ws.onmessage = e => handleMessage(e.data as string | ArrayBuffer)
        ws.onclose = () => {
            const live = shells.value.find(s => s.key === shell.key)
            if (live) live.alive = false
        }
        shell.alive = true
    }

    function open(target: ShellTarget): Shell {
        const key = shellKey(target)
        const existing = shells.value.find(s => s.key === key)
        if (existing) return existing
        shells.value.push({ ...target, key, alive: false })
        const shell = shells.value[shells.value.length - 1]
        connect(shell)
        return shell
    }

    function restart(key: string) {
        const shell = shells.value.find(s => s.key === key)
        if (shell && !shell.alive) connect(shell)
    }

    function setHost(key: string, el: HTMLElement | null) {
        if (!el) {
            hosts.delete(key)
            return
        }
        hosts.set(key, el)
        mount(key)
    }

    function focus(key: string) {
        sessions.get(key)?.term.focus()
    }

    return { shells, open, restart, setHost, focus }
})
