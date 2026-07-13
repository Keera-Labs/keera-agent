import { useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, Image } from 'lucide-react'
import AppLayout from '@/layouts/AppLayout'
import { ProjectLayout } from '@/layouts/ProjectLayout'
import { color } from '@/tokens'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from '@/types/agent'
import { agentColor } from '@/utils/agentColor'
import { useAgents } from '@/queries/agents'
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
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
                <DotsIndicator />
                <span style={{ color: color.warning, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>running</span>
            </span>
        )
    }
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '6px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color.success }} />
            <span style={{ color: color.success, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>done</span>
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
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            {/* Agents list — left */}
            <AgentsListPanel project={activeProject} />

            {/* Agent execution — chrome + terminal slot */}
            <div
                style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: '#fff' }}
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
                <div style={{
                    minHeight: '48px', flexShrink: 0, display: 'flex', alignItems: 'center',
                    paddingLeft: '16px', paddingRight: '14px', paddingTop: '7px', paddingBottom: '7px', gap: '10px',
                    borderBottom: `1px solid ${color.stroke}`, background: '#fff',
                }}>
                    <button
                        onClick={() => setActiveAgentId(null)}
                        title="Back"
                        style={{
                            background: 'transparent', border: 'none', color: color.textFaint, cursor: 'pointer',
                            padding: '4px', display: 'flex', alignItems: 'center', borderRadius: '4px',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = color.textPrimary; e.currentTarget.style.background = color.bgCanvas }}
                        onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
                    >
                        <ArrowLeft size={14}/>
                    </button>

                    <div style={{
                        width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0, background: agentBg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', fontWeight: 700, color: '#fff',
                    }}>
                        {displayName.charAt(0).toUpperCase()}
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {displayName}
                            </span>
                            <span style={{
                                fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px', letterSpacing: '0.04em',
                                background: `${agentBg}18`, border: `1px solid ${agentBg}40`, color: agentBg, flexShrink: 0,
                            }}>
                                {activeAgent ? (AGENT_TYPE_LABELS[activeAgent.agent_type] ?? activeAgent.agent_type).toUpperCase() : 'AGENT'}
                            </span>
                        </div>
                        {activeAgent && (
                            <span style={{ color: color.textMuted, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {activeAgent.model ? `${agentRoleLabel(activeAgent)} · ${activeAgent.model}` : agentRoleLabel(activeAgent)}
                            </span>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <ClaudeStatusBadge status={claudeStatus[activeProject.id]} />
                    </div>
                </div>

                {/* Drag overlay */}
                {isDraggingOver && (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 10, background: color.accentGlow,
                        border: `2px dashed ${color.accent}`, borderRadius: '4px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                    }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                            <Image size={36} color={color.accent} opacity={0.8}/>
                            <span style={{ color: color.accent, fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
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
                    style={{ display: 'none' }}
                    onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) uploadImage(file)
                        e.target.value = ''
                    }}
                />

                {/* Terminal slot — the active agent's live xterm is re-parented here */}
                <div ref={setSlot} style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: '8px', boxSizing: 'border-box' }} />
            </div>
        </div>
    )
}

// Nested persistent layouts — same refs as Home/Tasks so Inertia preserves them
// (and the terminal holder in AppLayout/AgentsIndex) across navigation.
AgentDetail.layout = [AppLayout, ProjectLayout]
