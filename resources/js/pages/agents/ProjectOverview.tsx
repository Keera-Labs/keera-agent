import { router } from '@inertiajs/react'
import { Check, GitMerge, Plus } from 'lucide-react'
import { color } from '@/tokens'
import { useAgents } from '@/queries/agentQuery'
import useWorkspaces from '@/queries/workspacesQuery'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import type { Project } from '@/types/type'
import { AgentCard } from './AgentCard'
import { AgentAddModal } from './AgentAddModal'
import { PLACEHOLDER } from './presentation'

// ─── Header status pill (light, bordered) ─────────────────────────────────────

function HeaderPill({ children }: { children: React.ReactNode }) {
    return (
        <span className="inline-flex items-center gap-1.5 bg-surface border border-stroke rounded-full py-[5px] px-3 text-[12.5px] text-zinc-700 whitespace-nowrap">
            {children}
        </span>
    )
}

// ─── Project overview — the redesigned project-detail dashboard ────────────────

export function ProjectOverview({ project }: { project: Project }) {
    const {
        agentSessions, launchAgentSession,
        setActiveAgentId,
    } = useAppLayout()
    const { workspaces } = useWorkspaces()
    const { agents, adoptWork } = useAgents(project.id)

    const workspaceName = workspaces.find(w => w.id === project.workspace_id)?.name ?? null
    const activeCount = agents.filter(a => agentSessions.current.has(a.id)).length

    return (
        <div className="flex-1 overflow-y-auto bg-[#f7f7f5]">
            <div className="max-w-[1180px] pt-[26px] px-[34px] pb-10">

                {/* Breadcrumb */}
                <div className="text-[13px] mb-3.5">
                    {workspaceName && (
                        <>
                            <span className="text-zinc-500">{workspaceName}</span>
                            <span className="text-zinc-400 my-0 mx-[7px]">/</span>
                        </>
                    )}
                    <span className="text-zinc-900 font-semibold">{project.name}</span>
                </div>

                {/* Header row: title + description + pills, and New Agent button */}
                <div className="flex items-start gap-5">
                    <div className="flex-1 min-w-0">
                        <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.02em] text-zinc-900">
                            {project.name}
                        </h1>

                        {/* Project description — omitted cleanly when the backend has none */}
                        {project.system_prompt && (
                            <p className="mt-2 mb-0 mx-0 text-[15px] leading-normal text-zinc-500 max-w-[680px]">
                                {project.system_prompt}
                            </p>
                        )}

                        {/* Status pills */}
                        <div className="flex flex-wrap gap-2 mt-4">
                            <HeaderPill>
                                <Check size={13} color={color.success}/>
                                {activeCount} active
                            </HeaderPill>
                            <HeaderPill>
                                <GitMerge size={13} color={color.textMuted}/>
                                {PLACEHOLDER}
                            </HeaderPill>
                            <HeaderPill>{agents.length} agents</HeaderPill>
                        </div>
                    </div>

                    <AgentAddModal
                        trigger={
                            <button
                                type="button"
                                className="shrink-0 flex items-center gap-[7px] bg-[#111318] border-0 rounded-lg text-white text-[13.5px] font-semibold py-2.5 px-4 cursor-pointer transition-opacity duration-100 hover:opacity-[0.88]"
                            >
                                <Plus size={13}/>
                                New Agent
                            </button>
                        }
                    />
                </div>

                {/* Agent cards grid */}
                {agents.length === 0 ? (
                    <div className="mt-7 p-12 text-center bg-surface border border-dashed border-stroke rounded-[16px]">
                        <p className="m-0 text-[14px] text-zinc-500">
                            No agents yet. Create one to get started.
                        </p>
                    </div>
                ) : (
                    <div className="mt-[26px] grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-[22px]">
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
