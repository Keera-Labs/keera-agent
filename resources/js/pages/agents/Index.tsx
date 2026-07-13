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
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

            {/* Project overview dashboard (shown when no agent is drilled into) */}
            {activeProject && !showTerminal && (
                <ProjectOverview project={activeProject} />
            )}

            {/* Persistent, off-screen terminal holder. Container divs stay mounted
                so xterm instances + WebSockets survive navigation; the agent detail
                page re-parents the active term into its slot and parks it back here. */}
            <div aria-hidden style={{
                position: 'absolute', left: '-99999px', top: 0,
                width: '900px', height: '600px', overflow: 'hidden', pointerEvents: 'none',
            }}>
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    {/* PM session containers (one per project) */}
                    {projects.map(project => (
                        <div
                            key={project.id}
                            ref={el => { containerRefs.current.set(project.id, el) }}
                            style={{ position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box' }}
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
                                style={{ position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box' }}
                            />
                        ))
                    })()}
                </div>
            </div>
        </div>
    )
}
