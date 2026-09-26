import { router, usePage } from '@inertiajs/vue3'
import { useQueryCache } from '@pinia/colada'
import { defineStore, storeToRefs } from 'pinia'
import { computed, markRaw, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { attachTerminal, reportSize, useTerminalSessions } from '@/composables/useTerminalSessions'
import { useAgents } from '@/queries/agentQuery'
import { AGENT_SUMMARIES_QUERY_KEY } from '@/queries/agentSummariesQuery'
import useProjects, { PROJECTS_QUERY_KEY } from '@/queries/projectsQuery'
import { useTasks } from '@/queries/taskQuery'
import { WORKSPACES_QUERY_KEY } from '@/queries/workspacesQuery'
import type { SettingsSectionId } from '@/layouts/settings/sections'
import { useEditorSettingsStore } from '@/stores/editorSettingsStore'
import { useProjectStore } from '@/stores/projectStore'
import type { AgentTemplate } from '@/types/agent'
import type { Project } from '@/types/type'

export type ProjectView = 'agents' | 'tasks' | 'commands'

type PageProps = {
    agent_id?: number
    global_settings?: { max_agents_per_project?: number }
}

const TERMINAL_NAV_KEYS = ['Enter', 'ArrowUp', 'ArrowDown', 'Tab']

/** A boolean ref mirrored to localStorage; storage failures degrade to in-memory state. */
function persistedFlag(key: string, initial: boolean) {
    let stored: boolean = initial
    try {
        const item = window.localStorage.getItem(key)
        if (item !== null) stored = JSON.parse(item) === true
    } catch { /* unavailable or corrupt: keep the default */ }
    const flag = ref(stored)
    watch(flag, value => {
        try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* in-memory only */ }
    })
    return flag
}

// State shared by the persistent AppLayout and everything rendered inside it.
// A store (not provide/inject) so the terminal sessions it owns live for the
// app's lifetime, independent of any component.
export const useAppLayoutStore = defineStore('appLayout', () => {
    const page = usePage<PageProps>()
    const queryCache = useQueryCache()
    const { projects } = useProjects()
    const { activeProject } = storeToRefs(useProjectStore())
    const activeProjectId = computed(() => activeProject.value?.id ?? null)

    const { tasks } = useTasks(activeProjectId)
    const agentHook = useAgents(activeProjectId)
    const projectAgents = agentHook.agents

    const terminals = useTerminalSessions({
        activeProject,
        projectAgents,
        onAgentCreated: agentHook.addAgent,
        onClaudeStopped: () => {},
        onAgentMessage: () => {},
        onAgentStatus: () => {
            queryCache.invalidateQueries({ key: AGENT_SUMMARIES_QUERY_KEY })
            queryCache.invalidateQueries({ key: ['agents'] })
        },
    })

    // Loaded up front: the saved font applies to terminals opened before any editor.
    useEditorSettingsStore().load()

    const showGlobalSettings = ref(false)
    const showDefaultPermissions = ref(false)
    const showProjectSearch = ref(false)
    // The open Settings section, or null while the Settings modal is closed.
    const settingsSection = ref<SettingsSectionId | null>(null)
    // The project whose system prompt / permissions dialog is open, or null when closed.
    const systemPromptProject = ref<Project | null>(null)
    const permissionsProject = ref<Project | null>(null)

    const projectView = ref<ProjectView>('agents')
    const sidebarOpen = persistedFlag('keera.layout.sidebarOpen', true)
    const rightPanelOpen = persistedFlag('keera.layout.rightPanelOpen', false)
    const statusBarOpen = persistedFlag('keera.layout.statusBarOpen', true)
    const isDraggingOver = ref(false)

    // Raw selection — may still name an agent of the previous project right after a switch.
    const selectedAgentId = ref<number | null>(null)
    const activeAgentId = computed(() =>
        selectedAgentId.value !== null && projectAgents.value.some(a => a.id === selectedAgentId.value)
            ? selectedAgentId.value
            : null,
    )
    function setActiveAgentId(id: number | null) {
        selectedAgentId.value = id
    }

    watch(
        () => projectAgents.value.find(a => a.id === page.props.agent_id)?.id,
        id => { if (id !== undefined) selectedAgentId.value = id },
        { immediate: true },
    )

    const maxAgentsPerProject = ref(page.props.global_settings?.max_agents_per_project ?? 10)
    watch(() => page.props.global_settings?.max_agents_per_project, v => {
        if (v !== undefined) maxAgentsPerProject.value = v
    })

    const agentTemplates = ref<AgentTemplate[]>([])
    // The EFFECTIVE list for the active project (project overrides resolved over
    // globals), which the global-only agent-templates query does not cover.
    function refetchAgentTemplates() {
        const url = activeProject.value
            ? `/api/projects/${activeProject.value.id}/agent-templates`
            : '/api/agent-templates'
        fetch(url)
            .then(r => r.json())
            .then((templates: AgentTemplate[]) => { agentTemplates.value = templates })
            .catch(() => {})
    }
    watch(activeProjectId, refetchAgentTemplates, { immediate: true })

    // Server-side status only seeds projects the live sockets haven't reported on yet.
    watch(() => projects.value.length, () => {
        for (const p of projects.value) {
            if (terminals.claudeStatus[p.id]) continue
            if (p.claude_status === 'running') terminals.setClaudeStatus(p.id, 'running')
            else if (p.claude_status === 'idle') terminals.setClaudeStatus(p.id, 'done')
        }
    }, { immediate: true })

    // Selecting an agent starts every agent of the project so they can talk to each other.
    // The PM is skipped: its PTY belongs to the PM session, and a second socket on the
    // same PTY would split the output between two terminals.
    watch([activeAgentId, () => projectAgents.value.length], ([agentId]) => {
        if (agentId === null || !activeProject.value) return
        requestAnimationFrame(() => {
            for (const agent of projectAgents.value) {
                if (agent.agent_type !== 'pm') terminals.launchAgentSession(agent.id, agent.id === agentId)
            }
        })
    })

    // Off-screen parking spot, mounted by AppLayout, that keeps xterm DOM alive
    // while no visible slot shows a terminal.
    const terminalHolder = shallowRef<HTMLElement | null>(null)
    function setTerminalHolder(el: HTMLElement | null) {
        terminalHolder.value = el
    }

    watch([terminalHolder, projectAgents], ([holder, agents]) => {
        if (!holder) return
        for (const agent of agents) {
            if (!terminals.agentContainerRefs.get(agent.id)) terminals.setAgentContainer(agent.id, holder)
        }
    })

    /** Show a project's PM terminal in a visible slot, launching the session into it if needed. */
    function showPmTerminal(projectId: number, slot: HTMLElement) {
        const session = terminals.sessions.get(projectId)
        if (!session) {
            terminals.setContainer(projectId, slot)
            return
        }
        terminals.containerRefs.set(projectId, slot)
        attachTerminal(session.term, slot)
        session.observer.disconnect()
        session.observer.observe(slot)
        requestAnimationFrame(() => { session.fitAddon.fit(); reportSize(session); session.term.focus() })
    }

    /** Move a project's PM terminal back to the holder before its slot goes away; the socket stays open. */
    function parkPmTerminal(projectId: number) {
        const holder = terminalHolder.value
        // No entry means the project was never shown or was deleted
        // (disposeProjectSessions); re-adding one would leak a stale ref.
        if (!holder || !terminals.containerRefs.has(projectId)) return
        // containerRefs is written directly: setContainer would re-launch/focus the
        // active project's terminal while it sits off-screen.
        terminals.containerRefs.set(projectId, holder)
        const session = terminals.sessions.get(projectId)
        if (!session) return
        session.observer.disconnect()
        attachTerminal(session.term, holder)
        reportSize(session)
    }

    function openSettings(section: SettingsSectionId = 'ai') {
        settingsSection.value = section
    }

    function closeSettings() {
        settingsSection.value = null
        // /settings is only a deep link into the modal; closing it leaves for the dashboard.
        if (page.component === 'settings/Index') router.visit('/', { replace: true })
    }

    // Back/forward or any link away from /settings takes the modal with it.
    watch(() => page.url, url => {
        if (!url.startsWith('/settings')) settingsSection.value = null
    })

    function refreshData() {
        // Workspace changes can reassign projects, so both lists are refreshed.
        queryCache.invalidateQueries({ key: WORKSPACES_QUERY_KEY })
        queryCache.invalidateQueries({ key: PROJECTS_QUERY_KEY })
    }

    function onKeyDown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
            e.preventDefault()
            showProjectSearch.value = !showProjectSearch.value
        }
    }
    // Scoped to xterm so forms, inputs and the editor keep Enter/Tab/arrow behaviour.
    function blockTerminalNavKeys(e: KeyboardEvent) {
        if (!TERMINAL_NAV_KEYS.includes(e.key)) return
        if (e.target instanceof Element && e.target.closest('.xterm')) e.preventDefault()
    }
    function warnOnUnload(e: BeforeUnloadEvent) {
        if (terminals.sessions.size > 0) e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('keydown', blockTerminalNavKeys)
    window.addEventListener('beforeunload', warnOnUnload)
    onScopeDispose(() => {
        window.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('keydown', blockTerminalNavKeys)
        window.removeEventListener('beforeunload', warnOnUnload)
    })

    return {
        tasks,
        showGlobalSettings,
        showDefaultPermissions,
        showProjectSearch,
        settingsSection,
        openSettings,
        closeSettings,
        systemPromptProject,
        permissionsProject,
        projectView,
        sidebarOpen,
        rightPanelOpen,
        statusBarOpen,
        activeAgentId,
        setActiveAgentId,
        isDraggingOver,
        // The store proxies everything it returns; xterm objects must stay raw.
        sessions: markRaw(terminals.sessions),
        agentSessions: markRaw(terminals.agentSessions),
        containerRefs: markRaw(terminals.containerRefs),
        agentContainerRefs: markRaw(terminals.agentContainerRefs),
        liveSessionCount: terminals.liveSessionCount,
        setContainer: terminals.setContainer,
        setAgentContainer: terminals.setAgentContainer,
        launchAgentSession: terminals.launchAgentSession,
        disposeAgentSession: terminals.disposeAgentSession,
        restartClaude: terminals.restartClaude,
        uploadImage: terminals.uploadImage,
        claudeStatus: terminals.claudeStatus,
        setClaudeStatus: terminals.setClaudeStatus,
        lastActivity: terminals.lastActivity,
        outputChars: terminals.outputChars,
        sessionStart: terminals.sessionStart,
        terminalHolder,
        setTerminalHolder,
        showPmTerminal,
        parkPmTerminal,
        refreshData,
        handleWorkspaceDeleted: refreshData,
        agentHook: markRaw(agentHook),
        agentTemplates,
        refetchAgentTemplates,
        maxAgentsPerProject,
    }
})
