import { useAgents } from '@/queries/agentQuery'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { useProjectStore } from '@/stores/projectStore'
import useProjects from '@/queries/projectsQuery'
import { ProjectOverview } from './ProjectOverview'

// ─── Agents view (rendered by the persistent ProjectLayout) ───────────────────
// Shows the project overview when no agent is drilled into. Its other job is to
// be the ALWAYS-MOUNTED, off-screen HOLDER for the xterm terminal containers:
// live agent/PM terminals park here so their PTY sessions never blank across
// navigation. The visible agent-execution view is owned by pages/agents/Detail,
// which re-parents the active agent's live term out of this holder and back.

export default function AgentsIndex() {
    const {
        activeAgentId,
        containerRefs,
        agentContainerRefs,
        agentSessions,
    } = useAppLayout()
    const activeProject = useProjectStore(s => s.activeProject)
    const { projects } = useProjects()

    const { agents: projectAgents } = useAgents(activeProject?.id ?? null)

    const showTerminal = activeAgentId !== null

    return (
        <div className="flex-1 overflow-hidden flex">

            {/* Project overview dashboard (shown when no agent is drilled into) */}
            {activeProject && !showTerminal && (
                <ProjectOverview project={activeProject} />
            )}

            {/* Persistent, off-screen terminal holder. Container divs stay mounted
                so xterm instances + WebSockets survive navigation; the agent detail
                page re-parents the active term into its slot and parks it back here. */}
            <div aria-hidden className="absolute left-[-99999px] top-0 w-[900px] h-[600px] overflow-hidden pointer-events-none">
                <div className="relative w-full h-full">
                    {/* PM session containers (one per project) */}
                    {projects.map(project => (
                        <div
                            key={project.id}
                            ref={el => { containerRefs.current.set(project.id, el) }}
                            className="absolute inset-0 p-2 box-border"
                        />
                    ))}
                    {/* Agent session containers — current project's agents + any live elsewhere */}
                    {(() => {
                        const liveIds = Array.from(agentSessions.current.keys())
                        const currentIds = new Set(projectAgents.map(a => a.id))
                        const extraIds = liveIds.filter(id => !currentIds.has(id))
                        const ids = [...projectAgents.map(a => a.id), ...extraIds]
                        return ids.map(id => (
                            <div
                                key={`agent-${id}`}
                                ref={el => { agentContainerRefs.current.set(id, el) }}
                                className="absolute inset-0 p-2 box-border"
                            />
                        ))
                    })()}
                </div>
            </div>
        </div>
    )
}
