import { router } from '@inertiajs/react'
import { color } from '@/tokens'
import { useAgents } from '@/queries/agents'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import type { Project } from '@/types/type'
import { AgentCard } from './AgentCard'
import { PLACEHOLDER } from './presentation'

const PAGE_BG = '#f7f7f5'

// ─── Header status pill (light, bordered) ─────────────────────────────────────

function HeaderPill({ children }: { children: React.ReactNode }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: color.bgSurface, border: `1px solid ${color.stroke}`,
            borderRadius: '999px', padding: '5px 12px',
            fontSize: '12.5px', color: color.textSecondary, whiteSpace: 'nowrap',
        }}>
            {children}
        </span>
    )
}

// ─── Project overview — the redesigned project-detail dashboard ────────────────

export function ProjectOverview({ project }: { project: Project }) {
    const {
        workspaces, agentSessions, launchAgentSession,
        setActiveAgentId, setEditingAgent, setShowAddAgent,
    } = useAppLayout()
    const { agents, adoptWork } = useAgents(project.id)

    const workspaceName = workspaces.find(w => w.id === project.workspace_id)?.name ?? null
    const activeCount = agents.filter(a => agentSessions.current.has(a.id)).length

    return (
        <div style={{ flex: 1, overflowY: 'auto', background: PAGE_BG }}>
            <div style={{ maxWidth: '1180px', padding: '26px 34px 40px' }}>

                {/* Breadcrumb */}
                <div style={{ fontSize: '13px', marginBottom: '14px' }}>
                    {workspaceName && (
                        <>
                            <span style={{ color: color.textMuted }}>{workspaceName}</span>
                            <span style={{ color: color.textFaint, margin: '0 7px' }}>/</span>
                        </>
                    )}
                    <span style={{ color: color.textPrimary, fontWeight: 600 }}>{project.name}</span>
                </div>

                {/* Header row: title + description + pills, and New Agent button */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h1 style={{
                            margin: 0, fontSize: '30px', fontWeight: 800,
                            letterSpacing: '-0.02em', color: color.textPrimary,
                        }}>
                            {project.name}
                        </h1>

                        {/* Project description — omitted cleanly when the backend has none */}
                        {project.system_prompt && (
                            <p style={{
                                margin: '8px 0 0', fontSize: '15px', lineHeight: 1.5,
                                color: color.textMuted, maxWidth: '680px',
                            }}>
                                {project.system_prompt}
                            </p>
                        )}

                        {/* Status pills */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
                            <HeaderPill>
                                <svg width="13" height="13" viewBox="0 0 16 16" fill={color.success}>
                                    <path d="M13.78 4.22a.75.75 0 010 1.06l-6.25 6.25a.75.75 0 01-1.06 0L2.22 7.28a.75.75 0 011.06-1.06L7 9.94l5.72-5.72a.75.75 0 011.06 0z"/>
                                </svg>
                                {activeCount} active
                            </HeaderPill>
                            <HeaderPill>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="6" y1="3" x2="6" y2="15" />
                                    <circle cx="18" cy="6" r="3" />
                                    <circle cx="6" cy="18" r="3" />
                                    <path d="M18 9a9 9 0 0 1-9 9" />
                                </svg>
                                {PLACEHOLDER}
                            </HeaderPill>
                            <HeaderPill>{agents.length} agents</HeaderPill>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowAddAgent(true)}
                        style={{
                            flexShrink: 0, display: 'flex', alignItems: 'center', gap: '7px',
                            background: '#111318', border: 'none', borderRadius: '10px',
                            color: '#fff', fontSize: '13.5px', fontWeight: 600,
                            padding: '10px 16px', cursor: 'pointer', transition: 'opacity 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                        </svg>
                        New Agent
                    </button>
                </div>

                {/* Agent cards grid */}
                {agents.length === 0 ? (
                    <div style={{
                        marginTop: '28px', padding: '48px', textAlign: 'center',
                        background: color.bgSurface, border: `1px dashed ${color.stroke}`, borderRadius: '16px',
                    }}>
                        <p style={{ margin: 0, fontSize: '14px', color: color.textMuted }}>
                            No agents yet. Create one to get started.
                        </p>
                    </div>
                ) : (
                    <div style={{
                        marginTop: '26px', display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '22px',
                    }}>
                        {agents.map(agent => (
                            <AgentCard
                                key={agent.id}
                                agent={agent}
                                running={agentSessions.current.has(agent.id)}
                                statusLine={agent.description}
                                adoptPending={adoptWork.isPending}
                                stats={{
                                    runtime: PLACEHOLDER,
                                    model: agent.model,
                                    branch: PLACEHOLDER,
                                    usage: PLACEHOLDER,
                                }}
                                onOpen={() => {
                                    // Drill in directly — the URL-driven effect only fires on an
                                    // agent_id change, so re-opening the agent you just backed out
                                    // of (URL unchanged) would otherwise be a no-op.
                                    setActiveAgentId(agent.id)
                                    router.visit(`/${project.slug}/agents/${agent.id}`)
                                }}
                                onEdit={() => setEditingAgent(agent)}
                                onRestart={() => {
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
                                onAdopt={async () => {
                                    if (adoptWork.isPending) return
                                    if (!window.confirm(`Adopt ${agent.name}'s work?\n\nThis removes the worktree and checks out branch worktree-agent-${agent.id} in the project (leaving it on that branch). Nothing is merged.`)) return
                                    try {
                                        await adoptWork.mutateAsync(agent.id)
                                        window.alert(`Removed ${agent.name}'s worktree and checked out its branch.`)
                                    } catch (err) {
                                        window.alert(err instanceof Error ? err.message : 'Failed to adopt agent work')
                                    }
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
