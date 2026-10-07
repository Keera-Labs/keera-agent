import { router } from '@inertiajs/vue3'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useAgents, type ProjectAgent } from '@/queries/agentQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import type { Project } from '@/types/type'

/** Agent actions shared by the overview cards and the agents list panel. */
export function useAgentActions(project: MaybeRefOrGetter<Project>) {
    const layout = useAppLayoutStore()
    const agentsQuery = useAgents(() => toValue(project).id)

    /**
     * Terminal sessions live in a plain Map Vue cannot track; reading
     * liveSessionCount makes callers re-render whenever a session opens or closes.
     */
    function isRunning(agentId: number): boolean {
        return layout.liveSessionCount >= 0 && layout.agentSessions.has(agentId)
    }

    // Drill in directly: the store only follows the URL's agent_id when it
    // changes, so re-opening the agent you just backed out of would be a no-op.
    function open(agent: ProjectAgent) {
        layout.setActiveAgentId(agent.id)
        router.visit(`/${toValue(project).slug}/agents/${agent.id}`)
    }

    function restart(agent: ProjectAgent) {
        layout.disposeAgentSession(agent.id)
        setTimeout(() => layout.launchAgentSession(agent.id, true), 300)
        layout.setActiveAgentId(agent.id)
    }

    async function adopt(agent: ProjectAgent) {
        if (agentsQuery.adoptWork.isLoading.value) return
        if (!window.confirm(`Adopt ${agent.name}'s work?\n\nThis removes the worktree and checks out branch worktree-agent-${agent.id} in the project (leaving it on that branch). Nothing is merged.`)) return
        try {
            await agentsQuery.adoptWork.mutateAsync(agent.id)
            window.alert(`Removed ${agent.name}'s worktree and checked out its branch.`)
        } catch (err) {
            window.alert(err instanceof Error ? err.message : 'Failed to adopt agent work')
        }
    }

    async function remove(agent: ProjectAgent) {
        if (agent.agent_type === 'pm') layout.disposePmSession(toValue(project).id)
        else layout.disposeAgentSession(agent.id)
        layout.agentContainerRefs.delete(agent.id)
        await agentsQuery.remove.mutateAsync(agent.id)
    }

    return {
        agents: agentsQuery.agents,
        isPending: agentsQuery.isPending,
        adoptPending: agentsQuery.adoptWork.isLoading,
        isRunning,
        open,
        restart,
        adopt,
        remove,
    }
}
