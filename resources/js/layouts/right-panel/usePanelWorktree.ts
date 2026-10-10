import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useViewedWorktree } from '@/composables/useViewedWorktree'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'

export function usePanelWorktree() {
    const layout = useAppLayoutStore()
    const { activeAgentId } = storeToRefs(layout)
    const { activeProject } = storeToRefs(useProjectStore())

    const projectId = computed(() => activeProject.value?.id ?? null)
    const worktreeAgentId = computed(() => {
        const agent = layout.agentHook.agents.value.find(a => a.id === activeAgentId.value)
        return agent && agent.agent_type !== 'pm' ? agent.id : null
    })

    return { activeProject, projectId, ...useViewedWorktree(projectId, worktreeAgentId) }
}
