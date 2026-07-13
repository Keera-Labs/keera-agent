import { type MouseEvent, type ReactNode } from 'react'
import { router } from '@inertiajs/react'
import { color } from '@/tokens'
import { useAgents } from '@/queries/agents'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import type { Project } from '@/types/type'
import { AgentAddModal } from './AgentAddModal'
import { AgentEditModal } from './AgentEditModal'
import { agentAvatarColor, agentInitials } from './presentation'

// ─── Compact action icon button (carried over from PR #207) ───────────────────

function CardIconButton({
    title, onClick, hoverColor = color.textPrimary, children,
}: {
    title: string
    onClick: (e: MouseEvent) => void
    hoverColor?: string
    children: ReactNode
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={e => { e.stopPropagation(); onClick(e) }}
            style={{
                background: 'transparent', border: 'none',
                color: color.textFaint, cursor: 'pointer',
                padding: '5px', borderRadius: '6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'color 0.1s, background 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = hoverColor; e.currentTarget.style.background = color.bgCanvas }}
            onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
        >
            {children}
        </button>
    )
}

// ─── Agents list — left panel of the agent-execution view ─────────────────────
// Selecting a card drills into the agent via activeAgentId; the terminal itself
// stays mounted in AgentsIndex, so PTY sessions are never torn down here.

export function AgentsListPanel({ project }: { project: Project }) {
    const {
        activeAgentId, setActiveAgentId,
        agentSessions, agentContainerRefs,
        launchAgentSession,
    } = useAppLayout()
    const { agents: projectAgents, remove: removeAgent, adoptWork } = useAgents(project.id)

    return (
        <div style={{
            width: '230px', flexShrink: 0, background: '#fff',
            borderRight: `1px solid ${color.stroke}`,
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
        }}>
            {/* Section header + bulk controls */}
            <div style={{ padding: '12px 14px 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: color.textFaint, flex: 1,
                }}>
                    Agents
                </span>

                {/* Start all */}
                {projectAgents.length >= 2 && (
                    <button
                        onClick={() => {
                            if (activeAgentId === null) setActiveAgentId(projectAgents[0].id)
                            else requestAnimationFrame(() => {
                                for (const agent of projectAgents) launchAgentSession(agent.id, agent.id === activeAgentId)
                            })
                        }}
                        title="Start all agents"
                        style={{
                            background: 'transparent', border: `1px solid ${color.stroke}`,
                            borderRadius: '4px', color: color.textFaint,
                            fontSize: '10px', lineHeight: 1, padding: '2px 6px',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#16a34a'; e.currentTarget.style.color = '#16a34a' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = color.stroke; e.currentTarget.style.color = color.textFaint }}
                    >
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                            <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
                        </svg>
                        All
                    </button>
                )}

                {/* Remove all */}
                {projectAgents.length > 0 && (
                    <button
                        onClick={async () => {
                            setActiveAgentId(null)
                            for (const agent of projectAgents) {
                                const session = agentSessions.current.get(agent.id)
                                if (session) {
                                    session.observer.disconnect()
                                    session.term.dispose()
                                    session.ws.close()
                                    agentSessions.current.delete(agent.id)
                                }
                                agentContainerRefs.current.delete(agent.id)
                                await removeAgent.mutateAsync(agent.id)
                            }
                        }}
                        title="Delete all agents"
                        className="border border-gray-200 rounded text-gray-500 text-[10px] leading-none px-1.5 py-0.5 cursor-pointer bg-transparent hover:border-red-500 hover:text-red-500 transition-colors"
                    >
                        ✕ all
                    </button>
                )}

                {/* Add agent */}
                <AgentAddModal
                    trigger={
                        <button
                            title="Add agent"
                            style={{
                                background: 'transparent', border: `1px solid ${color.stroke}`,
                                borderRadius: '4px', color: color.textFaint,
                                fontSize: '13px', lineHeight: 1, padding: '1px 6px',
                                cursor: 'pointer',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = color.accent; e.currentTarget.style.color = color.accent }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = color.stroke; e.currentTarget.style.color = color.textFaint }}
                        >
                            +
                        </button>
                    }
                />
            </div>

            {projectAgents.length === 0 ? (
                <div style={{ padding: '16px 14px' }}>
                    <p style={{ fontSize: '12px', color: color.textFaint, margin: 0, lineHeight: 1.5 }}>
                        No agents yet. Create one to get started.
                    </p>
                </div>
            ) : projectAgents.map(agent => {
                const isRunning = agentSessions.current.has(agent.id)
                const isSelected = agent.id === activeAgentId
                const statusColor = isRunning ? '#16a34a' : color.warningBright
                return (
                    <div
                        key={agent.id}
                        onClick={() => {
                            // Drill in via activeAgentId (the persistent-terminal flow) and keep
                            // the URL in sync; the terminal DOM stays mounted in AgentsIndex.
                            setActiveAgentId(agent.id)
                            router.visit(`/${project.slug}/agents/${agent.id}`)
                        }}
                        style={{
                            display: 'flex', flexDirection: 'column', gap: '8px',
                            padding: '10px 12px', margin: '0 8px 6px', borderRadius: '10px',
                            cursor: 'pointer', transition: 'background 0.1s, border-color 0.1s',
                            background: isSelected ? color.accentSubtle : '#fff',
                            border: `1px solid ${isSelected ? '#b6d0f7' : color.stroke}`,
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = color.bgCanvas }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff' }}
                    >
                        {/* Avatar + name + status */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                                <div style={{
                                    width: '32px', height: '32px', borderRadius: '8px',
                                    background: agentAvatarColor(agent), display: 'flex',
                                    alignItems: 'center', justifyContent: 'center',
                                    fontSize: '11px', fontWeight: 700, color: '#fff',
                                }}>
                                    {agentInitials(agent.name)}
                                </div>
                                {isRunning && (
                                    <span style={{
                                        position: 'absolute', bottom: '-2px', right: '-2px',
                                        width: '10px', height: '10px', borderRadius: '50%',
                                        background: '#22c55e', border: '2px solid #fff',
                                        display: 'block',
                                    }} />
                                )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: '13px', fontWeight: isSelected ? 600 : 500,
                                    color: isSelected ? color.accent : color.textPrimary,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {agent.name}
                                </div>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '5px',
                                    fontSize: '11px', marginTop: '2px', color: statusColor,
                                }}>
                                    <span style={{
                                        width: '6px', height: '6px', borderRadius: '50%',
                                        background: statusColor, flexShrink: 0,
                                    }} />
                                    {isRunning ? 'Active' : 'Waiting'}
                                </div>
                            </div>
                        </div>

                        {/* Action icons — restart · record/edit · branch · close */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <CardIconButton
                                title={isRunning ? 'Restart agent' : 'Start agent'}
                                hoverColor="#ca8a04"
                                onClick={() => {
                                    const session = agentSessions.current.get(agent.id)
                                    if (session) {
                                        session.observer.disconnect()
                                        session.term.dispose()
                                        session.ws.close()
                                        agentSessions.current.delete(agent.id)
                                    }
                                    setTimeout(() => launchAgentSession(agent.id, true), 300)
                                    setActiveAgentId(agent.id)
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M23 4v6h-6" />
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                                </svg>
                            </CardIconButton>

                            {/* Stop propagation so opening the edit modal doesn't also
                                drill into the agent via the row's onClick. */}
                            <span style={{ display: 'inline-flex' }} onClick={e => e.stopPropagation()}>
                                <AgentEditModal
                                    agent={agent}
                                    trigger={
                                        <button
                                            type="button"
                                            title="Edit agent"
                                            style={{
                                                background: 'transparent', border: 'none',
                                                color: color.textFaint, cursor: 'pointer',
                                                padding: '5px', borderRadius: '6px',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0, transition: 'color 0.1s, background 0.1s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.color = color.textPrimary; e.currentTarget.style.background = color.bgCanvas }}
                                            onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                                <circle cx="12" cy="12" r="8" />
                                                <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                                            </svg>
                                        </button>
                                    }
                                />
                            </span>

                            <CardIconButton
                                title="Adopt work — remove worktree, check out the agent branch"
                                hoverColor="#16a34a"
                                onClick={async () => {
                                    if (adoptWork.isPending) return
                                    if (!window.confirm(`Adopt ${agent.name}'s work?\n\nThis removes the worktree and checks out branch worktree-agent-${agent.id} in the project (leaving it on that branch). Nothing is merged.`)) return
                                    try {
                                        await adoptWork.mutateAsync(agent.id)
                                        window.alert(`Removed ${agent.name}'s worktree and checked out its branch.`)
                                    } catch (err) {
                                        window.alert(err instanceof Error ? err.message : 'Failed to adopt agent work')
                                    }
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="6" y1="3" x2="6" y2="15" />
                                    <circle cx="18" cy="6" r="3" />
                                    <circle cx="6" cy="18" r="3" />
                                    <path d="M18 9a9 9 0 0 1-9 9" />
                                </svg>
                            </CardIconButton>

                            <CardIconButton
                                title="Remove agent"
                                hoverColor={color.danger}
                                onClick={async () => {
                                    const session = agentSessions.current.get(agent.id)
                                    if (session) {
                                        session.observer.disconnect()
                                        session.term.dispose()
                                        session.ws.close()
                                        agentSessions.current.delete(agent.id)
                                    }
                                    agentContainerRefs.current.delete(agent.id)
                                    if (activeAgentId === agent.id) {
                                        const remaining = projectAgents.filter(a => a.id !== agent.id)
                                        setActiveAgentId(remaining.length > 0 ? remaining[0].id : null)
                                    }
                                    await removeAgent.mutateAsync(agent.id)
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                </svg>
                            </CardIconButton>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
