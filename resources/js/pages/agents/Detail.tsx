import { useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, Image } from 'lucide-react'
import AppLayout from '@/layouts/AppLayout'
import { ProjectLayout } from '@/layouts/ProjectLayout'
import { color } from '@/tokens'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from '@/types/agent'
import { agentColor } from '@/utils/agentColor'
import { useAgents } from '@/queries/agentQuery'
import { attachTerminal } from '@/hooks/useTerminalSessions'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { useProjectStore } from '@/stores/projectStore'
import { DotsIndicator } from '@/layouts/sidebar/Project'
import { AgentsListPanel } from './AgentsListPanel'
import { ProjectOverview } from './ProjectOverview'
import { agentRoleLabel } from './presentation'

// ─── Claude status badge ──────────────────────────────────────────────────────

function ClaudeStatusBadge({ status }: { status?: 'running' | 'done' }) {
    if (!status) return null
    if (status === 'running') {
        return (
            <span className="flex items-center gap-1.5 ml-2">
                <DotsIndicator />
                <span className="text-amber-700 text-[11px] font-mono">running</span>
            </span>
        )
    }
    return (
        <span className="flex items-center gap-[5px] ml-1.5">
            <span className="w-[7px] h-[7px] rounded-full bg-success" />
            <span className="text-success text-[11px] font-mono">done</span>
        </span>
    )
}

// ─── Agent detail page ────────────────────────────────────────────────────────
// Served at /{project}/agents/{id}. Owns the agent-execution chrome (agents list,
// header, image-drop) and a terminal SLOT. The xterm instances + WebSockets stay
// owned by AppLayout/AppLayoutContext; on mount this page re-parents the active
// agent's live term into its slot, and on unmount parks it back in the persistent
// holder (AgentsIndex) — the WebSocket is never closed, so PTY sessions survive.

export default function AgentDetail() {
    const {
        activeAgentId,
        setActiveAgentId,
        agentSessions,
        agentContainerRefs,
        agentTerminalSlot,
        launchAgentSession,
        isDraggingOver,
        setIsDraggingOver,
        uploadImage,
        fileInputRef,
        claudeStatus,
    } = useAppLayout()
    const activeProject = useProjectStore(s => s.activeProject)

    const { agents: projectAgents } = useAgents(activeProject?.id ?? null)

    const activeAgent = activeAgentId !== null
        ? projectAgents.find(a => a.id === activeAgentId) ?? null
        : null
    const agentBg = activeAgent
        ? (AGENT_TYPE_COLORS[activeAgent.agent_type] ?? color.accent)
        : (activeProject ? agentColor(activeProject.name) : color.accent)
    const displayName = activeAgent ? activeAgent.name : (activeProject?.name ?? '')

    // Register the slot node so launchAgentSession attaches new terms here directly.
    const slotRef = useRef<HTMLDivElement | null>(null)
    const setSlot = useCallback((node: HTMLDivElement | null) => {
        slotRef.current = node
        agentTerminalSlot.current = node
    }, [agentTerminalSlot])

    // Re-parent the active agent's live term into the slot; park it back on unmount
    // or when switching agents. Never closes the WS — only moves the xterm DOM.
    useEffect(() => {
        const slot = slotRef.current
        if (activeAgentId === null || !slot) return
        const sess = agentSessions.current.get(activeAgentId)
        if (sess) {
            // Move the live terminal into the visible slot. term.open() can't
            // re-parent an already-open terminal, so attachTerminal relocates its
            // root element when the session already exists (e.g. it was launched
            // into the off-screen holder during the navigation transition).
            attachTerminal(sess.term, slot)
            sess.observer.disconnect()
            sess.observer.observe(slot)
            sess.fitAddon.fit()
            sess.term.focus()
        } else {
            // No session yet. The context "start all agents" effect fires during the
            // Inertia navigation transition — before this slot is registered — so it
            // can attach to the off-screen holder or no-op and never retry. Now that
            // the slot is mounted, establish the active agent's session directly in
            // it. launchAgentSession is idempotent, so this can't open a second PTY.
            launchAgentSession(activeAgentId, true)
        }
        const parkedId = activeAgentId
        return () => {
            // Park the terminal back in its off-screen holder before the slot
            // unmounts. Without this the terminal's DOM dies with the slot and the
            // surviving session has no element to re-attach on return — a blank page.
            const s = agentSessions.current.get(parkedId)
            const holder = agentContainerRefs.current.get(parkedId)
            if (s && holder) {
                attachTerminal(s.term, holder)
                // Stop observing the visible slot; the (possibly hidden) holder
                // isn't observed — a refit runs when the term re-attaches to a slot.
                s.observer.disconnect()
            }
        }
    }, [activeAgentId, agentSessions, agentContainerRefs])

    if (!activeProject) return null

    // Back / no-selection: render the overview in place. Navigating to /{slug}
    // would 302 to the default agent and bounce straight back here, so the page
    // owns the overview too (the URL stays on the agent route — harmless).
    if (activeAgentId === null) return <ProjectOverview project={activeProject} />

    return (
        <div className="flex-1 overflow-hidden flex">
            {/* Agents list — left */}
            <AgentsListPanel project={activeProject} />

            {/* Agent execution — chrome + terminal slot */}
            <div
                className="flex-1 flex flex-col overflow-hidden relative bg-white"
                onDragOver={e => { e.preventDefault(); setIsDraggingOver(true) }}
                onDragEnter={e => { e.preventDefault(); setIsDraggingOver(true) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false) }}
                onDrop={e => {
                    e.preventDefault()
                    setIsDraggingOver(false)
                    const file = e.dataTransfer.files[0]
                    if (file) uploadImage(file)
                }}
            >
                {/* Header */}
                <div className="min-h-[48px] shrink-0 flex items-center pl-4 pr-3.5 pt-[7px] pb-[7px] gap-2.5 border-b border-stroke bg-white">
                    <button
                        onClick={() => setActiveAgentId(null)}
                        title="Back"
                        className="bg-transparent border-0 text-zinc-400 cursor-pointer p-1 flex items-center rounded-sm hover:text-zinc-900 hover:bg-canvas"
                    >
                        <ArrowLeft size={14}/>
                    </button>

                    <div
                        className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
                        style={{ background: agentBg }}
                    >
                        {displayName.charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-px">
                        <div className="flex items-center gap-2">
                            <span className="text-zinc-900 text-[13px] font-semibold truncate">
                                {displayName}
                            </span>
                            <span
                                className="text-[10px] font-semibold py-0.5 px-[7px] rounded-lg tracking-[0.04em] border shrink-0"
                                style={{ background: `${agentBg}18`, borderColor: `${agentBg}40`, color: agentBg }}
                            >
                                {activeAgent ? (AGENT_TYPE_LABELS[activeAgent.agent_type] ?? activeAgent.agent_type).toUpperCase() : 'AGENT'}
                            </span>
                        </div>
                        {activeAgent && (
                            <span className="text-zinc-500 text-[12px] truncate">
                                {activeAgent.model ? `${agentRoleLabel(activeAgent)} · ${activeAgent.model}` : agentRoleLabel(activeAgent)}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <ClaudeStatusBadge status={claudeStatus[activeProject.id]} />
                    </div>
                </div>

                {/* Drag overlay */}
                {isDraggingOver && (
                    <div className="absolute inset-0 z-10 bg-[rgba(9,105,218,0.08)] border-2 border-dashed border-accent rounded-sm flex items-center justify-center pointer-events-none">
                        <div className="flex flex-col items-center gap-2.5">
                            <Image size={36} color={color.accent} opacity={0.8}/>
                            <span className="text-accent text-[13px] font-mono">
                                Drop image to attach
                            </span>
                        </div>
                    </div>
                )}

                {/* Hidden file input for image uploads */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) uploadImage(file)
                        e.target.value = ''
                    }}
                />

                {/* Terminal slot — the active agent's live xterm is re-parented here.
                    bg-canvas matches XTERM_THEME.background exactly so the p-2 padding
                    blends into the xterm canvas with no color seam. */}
                <div ref={setSlot} className="flex-1 relative overflow-hidden bg-canvas p-2 box-border" />
            </div>
        </div>
    )
}

// Nested persistent layouts — same refs as Home/Tasks so Inertia preserves them
// (and the terminal holder in AppLayout/AgentsIndex) across navigation.
AgentDetail.layout = [AppLayout, ProjectLayout]
