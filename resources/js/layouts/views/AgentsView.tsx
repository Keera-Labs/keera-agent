import { useEffect, useState } from 'react'
import { router } from '@inertiajs/react'
import { color } from '@/tokens'
import { agentColor } from '@/utils/agentColor'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from '@/types/agent'
import { useAgents } from '@/layouts/hooks/agents'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { DotsIndicator } from '@/layouts/sidebar/Project'

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

// ─── AgentsView ───────────────────────────────────────────────────────────────

export function AgentsView() {
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
        launchAgentSession,
        restartClaude,
        uploadImage,
        claudeStatus,
        fileInputRef,
        setEditingAgent,
        setShowAddAgent,
    } = useAppLayout()

    const { agents: projectAgents, remove: removeAgent } = useAgents(activeProject?.id ?? null)

    // Derived
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

            {/* ─── Agent cards list — left panel ────────────────────────────── */}
            <div style={{
                width: '230px', flexShrink: 0, background: '#fff',
                borderRight: `1px solid ${color.stroke}`,
                display: 'flex', flexDirection: 'column', overflowY: 'auto',
            }}>
                {activeProject && (
                    <>
                        {/* Section header */}
                        <div style={{ padding: '12px 14px 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{
                                fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                                letterSpacing: '0.08em', color: color.textFaint, flex: 1,
                            }}>
                                Agents
                            </span>
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
                            {projectAgents.some(a => !agentSessions.current.has(a.id)) && (
                                <button
                                    onClick={async () => {
                                        const idle = projectAgents.filter(a => !agentSessions.current.has(a.id))
                                        const idleIds = new Set(idle.map(a => a.id))
                                        if (activeAgentId !== null && idleIds.has(activeAgentId)) {
                                            const remaining = projectAgents.filter(a => !idleIds.has(a.id))
                                            setActiveAgentId(remaining.length > 0 ? remaining[0].id : null)
                                        }
                                        for (const agent of idle) {
                                            agentContainerRefs.current.delete(agent.id)
                                            await removeAgent.mutateAsync(agent.id)
                                        }
                                    }}
                                    title="Delete idle agents"
                                    className="border border-gray-200 rounded text-gray-500 text-[10px] leading-none px-1.5 py-0.5 cursor-pointer bg-transparent hover:border-red-400 hover:text-red-400 transition-colors"
                                >
                                    ✕ idle
                                </button>
                            )}
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
                            <button
                                onClick={() => setShowAddAgent(true)}
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
                            const agentItemBg = AGENT_TYPE_COLORS[agent.agent_type] ?? color.accent
                            return (
                                <div
                                    key={agent.id}
                                    onClick={() => {
                                        if (activeProject) {
                                            router.visit(`/${activeProject.slug}/agents/${agent.id}`)
                                        } else {
                                            setActiveAgentId(agent.id)
                                        }
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '10px',
                                        padding: '9px 12px', margin: '0 8px 2px', borderRadius: '8px',
                                        cursor: 'pointer', transition: 'background 0.1s',
                                        background: isSelected ? color.accentSubtle : 'transparent',
                                        border: `1px solid ${isSelected ? '#b6d0f7' : 'transparent'}`,
                                    }}
                                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = color.bgCanvas }}
                                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                                >
                                    {/* Avatar with online indicator */}
                                    <div style={{ position: 'relative', flexShrink: 0 }}>
                                        <div style={{
                                            width: '32px', height: '32px', borderRadius: '8px',
                                            background: agentItemBg, display: 'flex',
                                            alignItems: 'center', justifyContent: 'center',
                                            fontSize: '11px', fontWeight: 700, color: '#fff',
                                            boxShadow: isSelected ? `0 0 0 2px ${'#fff'}, 0 0 0 3px ${agentItemBg}` : 'none',
                                        }}>
                                            {agent.name.slice(0, 2).toUpperCase()}
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

                                    {/* Name + status */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: '13px', fontWeight: isSelected ? 600 : 500,
                                            color: isSelected ? color.accent : color.textPrimary,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            {agent.name}
                                        </div>
                                        <div style={{ fontSize: '11px', color: isRunning ? '#16a34a' : color.textFaint, marginTop: '1px' }}>
                                            {isRunning ? '● Active' : AGENT_TYPE_LABELS[agent.agent_type] ?? agent.agent_type}
                                        </div>
                                    </div>

                                    {/* Restart button */}
                                    <button
                                        onClick={e => {
                                            e.stopPropagation()
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
                                        title={isRunning ? 'Restart agent' : 'Start agent'}
                                        style={{
                                            background: 'transparent', border: 'none',
                                            color: isRunning ? '#ca8a04' : color.textFaint,
                                            cursor: 'pointer',
                                            padding: '3px', borderRadius: '4px',
                                            display: 'flex', alignItems: 'center', flexShrink: 0,
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.color = '#ca8a04')}
                                        onMouseLeave={e => (e.currentTarget.style.color = isRunning ? '#ca8a04' : color.textFaint)}
                                    >
                                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                                            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                                        </svg>
                                    </button>

                                    {/* Settings/edit button */}
                                    <button
                                        onClick={e => { e.stopPropagation(); setEditingAgent(agent) }}
                                        title="Edit agent"
                                        style={{
                                            background: 'transparent', border: 'none',
                                            color: color.textFaint, cursor: 'pointer',
                                            padding: '3px', borderRadius: '4px',
                                            display: 'flex', alignItems: 'center', flexShrink: 0,
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.color = color.textPrimary)}
                                        onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                    >
                                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                                            <path fillRule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/>
                                        </svg>
                                    </button>

                                    {/* Run button (when idle) */}
                                    {!isRunning && (
                                        <button
                                            onClick={e => { e.stopPropagation(); setActiveAgentId(agent.id) }}
                                            title="Run"
                                            style={{
                                                background: 'transparent', border: 'none',
                                                color: color.textFaint, cursor: 'pointer',
                                                padding: '3px', borderRadius: '4px',
                                                display: 'flex', alignItems: 'center',
                                                flexShrink: 0,
                                            }}
                                            onMouseEnter={e => (e.currentTarget.style.color = '#16a34a')}
                                            onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                                <path d="M3 2l11 6-11 6V2z"/>
                                            </svg>
                                        </button>
                                    )}

                                    {/* Delete button */}
                                    <button
                                        onClick={async e => {
                                            e.stopPropagation()
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
                                        title="Remove"
                                        style={{
                                            background: 'transparent', border: 'none',
                                            color: color.textFaint, cursor: 'pointer',
                                            padding: '3px 5px', borderRadius: '4px',
                                            fontSize: '15px', lineHeight: 1, flexShrink: 0,
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.color = color.danger)}
                                        onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                    >
                                        ×
                                    </button>
                                </div>
                            )
                        })}
                    </>
                )}
            </div>

            {/* ─── Chat / Terminal Panel ─────────────────────────────────────── */}
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
                {/* ── Chat panel header ── */}
                {activeProject && (() => {
                    return (
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
                    )
                })()}

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
                    {/* Agent session containers */}
                    {projectAgents.map(agent => {
                        const isActive = agent.id === activeAgentId
                        const hasSession = agentSessions.current.has(agent.id)
                        return (
                            <div
                                key={`agent-${agent.id}`}
                                ref={el => { agentContainerRefs.current.set(agent.id, el) }}
                                style={{
                                    position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box',
                                    ...(isActive
                                        ? { display: 'block' }
                                        : hasSession
                                            ? { display: 'block', visibility: 'hidden' as const, pointerEvents: 'none' as const }
                                            : { display: 'none' }),
                                }}
                            />
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
