import { type MouseEvent, type ReactNode } from 'react'
import { router } from '@inertiajs/react'
import { Play, RotateCw, CircleDot, GitMerge, X } from 'lucide-react'
import { color } from '@/tokens'
import { useAgents } from '@/queries/agentQuery'
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
            className="bg-transparent border-0 text-zinc-400 cursor-pointer p-[5px] rounded flex items-center justify-center shrink-0 transition-[color,background] duration-100"
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
        <div className="w-[230px] shrink-0 bg-white border-r border-stroke flex flex-col overflow-y-auto">
            {/* Section header + bulk controls */}
            <div className="pt-3 px-3.5 pb-1.5 flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-400 flex-1">
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
                        className="bg-transparent border border-stroke rounded-sm text-zinc-400 text-[10px] leading-none py-0.5 px-1.5 cursor-pointer flex items-center gap-[3px] hover:border-[#16a34a] hover:text-[#16a34a]"
                    >
                        <Play size={8} fill="currentColor"/>
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
                            className="bg-transparent border border-stroke rounded-sm text-zinc-400 text-[13px] leading-none py-px px-1.5 cursor-pointer hover:border-accent hover:text-accent"
                        >
                            +
                        </button>
                    }
                />
            </div>

            {projectAgents.length === 0 ? (
                <div className="py-4 px-3.5">
                    <p className="text-[12px] text-zinc-400 m-0 leading-normal">
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
                        className={`flex flex-col gap-2 py-2.5 px-3 mt-0 mx-2 mb-1.5 rounded-lg cursor-pointer transition-[background,border-color] duration-100 border ${isSelected ? 'bg-blue-50 border-[#b6d0f7]' : 'bg-white border-stroke'}`}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = color.bgCanvas }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff' }}
                    >
                        {/* Avatar + name + status */}
                        <div className="flex items-center gap-2.5">
                            <div className="relative shrink-0">
                                <div
                                    className="w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-bold text-white"
                                    style={{ background: agentAvatarColor(agent) }}
                                >
                                    {agentInitials(agent.name)}
                                </div>
                                {isRunning && (
                                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#22c55e] border-2 border-white block" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className={`text-[13px] truncate ${isSelected ? 'font-semibold text-accent' : 'font-medium text-zinc-900'}`}>
                                    {agent.name}
                                </div>
                                <div className="flex items-center gap-[5px] text-[11px] mt-0.5" style={{ color: statusColor }}>
                                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor }} />
                                    {isRunning ? 'Active' : 'Waiting'}
                                </div>
                            </div>
                        </div>

                        {/* Action icons — restart · record/edit · branch · close */}
                        <div className="flex items-center gap-0.5">
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
                                <RotateCw size={14}/>
                            </CardIconButton>

                            {/* Stop propagation so opening the edit modal doesn't also
                                drill into the agent via the row's onClick. */}
                            <span className="inline-flex" onClick={e => e.stopPropagation()}>
                                <AgentEditModal
                                    agent={agent}
                                    trigger={
                                        <button
                                            type="button"
                                            title="Edit agent"
                                            className="bg-transparent border-0 text-zinc-400 cursor-pointer p-[5px] rounded flex items-center justify-center shrink-0 transition-[color,background] duration-100 hover:text-zinc-900 hover:bg-canvas"
                                        >
                                            <CircleDot size={14}/>
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
                                <GitMerge size={14}/>
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
                                <X size={14}/>
                            </CardIconButton>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
