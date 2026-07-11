import { color } from '@/tokens'
import { agentColor } from '@/utils/agentColor'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from '@/types/agent'
import { useAgents } from '@/layouts/hooks/agents'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { DotsIndicator } from '@/layouts/sidebar/Project'
import { ProjectOverview } from './ProjectOverview'
import { AgentsListPanel } from './AgentsListPanel'

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

// ─── Agents page ──────────────────────────────────────────────────────────────
// Renders the project-overview dashboard (ProjectOverview) when no agent is
// drilled into, and the agent terminal when one is. The terminal panel stays
// mounted (display-toggled) in both modes so PTY sessions never blank out.

export default function AgentsIndex() {
    const {
        activeProject,
        allProjects,
        activeAgentId,
        setActiveAgentId,
        isDraggingOver,
        setIsDraggingOver,
        containerRefs,
        agentContainerRefs,
        agentSessions,
        restartClaude,
        uploadImage,
        claudeStatus,
        fileInputRef,
    } = useAppLayout()

    const { agents: projectAgents } = useAgents(activeProject?.id ?? null)

    const showTerminal = activeAgentId !== null

    // Derived (terminal header)
    const activeAgent = activeAgentId !== null
        ? projectAgents.find(a => a.id === activeAgentId) ?? null
        : null
    const agentBg = activeAgent
        ? (AGENT_TYPE_COLORS[activeAgent.agent_type] ?? color.accent)
        : (activeProject ? agentColor(activeProject.name) : color.accent)
    const displayName = activeAgent ? activeAgent.name : (activeProject?.name ?? '')
    const displayRole = activeAgent
        ? (AGENT_TYPE_LABELS[activeAgent.agent_type] ?? activeAgent.agent_type)
        : (activeProject?.language ?? '')

    return (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

            {/* ─── Project overview dashboard (shown when no agent is drilled into) ── */}
            {activeProject && !showTerminal && (
                <ProjectOverview project={activeProject} />
            )}

            {/* ─── Agents list — left panel of the agent-execution view ─────────── */}
            {activeProject && showTerminal && (
                <AgentsListPanel project={activeProject} />
            )}

            {/* ─── Chat / Terminal Panel — kept mounted to preserve live sessions ─── */}
            <div
                style={{
                    flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative', background: '#fff',
                    display: showTerminal ? 'flex' : 'none',
                }}
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
                {/* ── Chat panel header ── */}
                {activeProject && (
                    <div style={{
                        height: '48px', flexShrink: 0, display: 'flex', alignItems: 'center',
                        paddingLeft: '16px', paddingRight: '14px', gap: '10px',
                        borderBottom: `1px solid ${color.stroke}`, background: '#fff',
                    }}>
                        {/* Back button (agent view) */}
                        {activeAgent && (
                            <button
                                onClick={() => setActiveAgentId(null)}
                                title="Back"
                                style={{
                                    background: 'transparent', border: 'none',
                                    color: color.textFaint, cursor: 'pointer',
                                    padding: '4px', display: 'flex', alignItems: 'center', borderRadius: '4px',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = color.textPrimary; e.currentTarget.style.background = color.bgCanvas }}
                                onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
                            >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z"/>
                                </svg>
                            </button>
                        )}

                        {/* Avatar */}
                        <div style={{
                            width: '28px', height: '28px',
                            borderRadius: activeAgent ? '8px' : '50%',
                            flexShrink: 0, background: agentBg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '11px', fontWeight: 700, color: '#fff',
                        }}>
                            {displayName.charAt(0).toUpperCase()}
                        </div>

                        {/* Name + badge */}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {displayName}
                            </span>
                            <span style={{
                                fontSize: '10px', fontWeight: 600, padding: '2px 7px',
                                borderRadius: '10px', letterSpacing: '0.04em',
                                background: activeAgent ? `${agentBg}18` : color.bgCanvas,
                                border: `1px solid ${activeAgent ? agentBg + '40' : color.stroke}`,
                                color: activeAgent ? agentBg : color.textMuted,
                                flexShrink: 0,
                            }}>
                                {activeAgent ? 'AGENT_EXECUTION' : displayRole.toUpperCase()}
                            </span>
                        </div>

                        {/* Status + Restart */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            <ClaudeStatusBadge status={claudeStatus[activeProject.id]} />
                            {!activeAgent && (
                                <button
                                    onClick={restartClaude}
                                    style={{
                                        background: 'transparent', border: `1px solid ${color.stroke}`,
                                        borderRadius: '6px', color: color.textMuted, fontSize: '11px',
                                        padding: '4px 10px', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: '5px',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = color.textMuted; e.currentTarget.style.color = color.textPrimary }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = color.stroke; e.currentTarget.style.color = color.textMuted }}
                                >
                                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M8 2.5a5.487 5.487 0 00-4.131 1.869l1.204 1.204A.25.25 0 014.896 6H1.25A.25.25 0 011 5.75V2.104a.25.25 0 01.427-.177l1.38 1.38A7.001 7.001 0 0114.95 7.16a.75.75 0 11-1.49.178A5.501 5.501 0 008 2.5zM1.705 8.005a.75.75 0 01.834.656 5.501 5.501 0 009.592 2.97l-1.204-1.204a.25.25 0 01.177-.427h3.646a.25.25 0 01.25.25v3.646a.25.25 0 01-.427.177l-1.38-1.38A7.001 7.001 0 011.05 8.84a.75.75 0 01.656-.834z"/>
                                    </svg>
                                    Restart
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Drag overlay */}
                {isDraggingOver && activeProject && (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 10,
                        background: color.accentGlow,
                        border: `2px dashed ${color.accent}`, borderRadius: '4px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        pointerEvents: 'none',
                    }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                            <svg width="36" height="36" viewBox="0 0 16 16" fill={color.accent} opacity="0.8">
                                <path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h.94l.03-.013 4.013-4.013a1.75 1.75 0 012.474 0L13.62 13.5h.63a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm9.5 3.5a1 1 0 11-2 0 1 1 0 012 0z"/>
                            </svg>
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

                {/* Terminal body — xterm containers */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                    {/* PM session containers (one per project) */}
                    {allProjects.map(project => (
                        <div
                            key={project.id}
                            ref={el => { containerRefs.current.set(project.id, el) }}
                            style={{
                                position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box',
                                display: project.id === activeProject?.id && activeAgentId === null ? 'block' : 'none',
                            }}
                        />
                    ))}
                    {/* Agent session containers — render for current project's agents + any with live sessions */}
                    {(() => {
                        const liveIds = Array.from(agentSessions.current.keys())
                        const currentIds = new Set(projectAgents.map(a => a.id))
                        const extraIds = liveIds.filter(id => !currentIds.has(id))

                        const allAgentEntries = [
                            ...projectAgents.map(a => ({ id: a.id, isCurrent: true })),
                            ...extraIds.map(id => ({ id, isCurrent: false })),
                        ]

                        return allAgentEntries.map(({ id, isCurrent }) => {
                            const isActive = id === activeAgentId
                            const hasSession = agentSessions.current.has(id)
                            return (
                                <div
                                    key={`agent-${id}`}
                                    ref={el => { agentContainerRefs.current.set(id, el) }}
                                    style={{
                                        position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box',
                                        ...(isActive && isCurrent
                                            ? { display: 'block' }
                                            : hasSession
                                                ? { display: 'block', visibility: 'hidden' as const, pointerEvents: 'none' as const }
                                                : { display: 'none' }),
                                    }}
                                />
                            )
                        })
                    })()}
                </div>
            </div>
        </div>
    )
}
