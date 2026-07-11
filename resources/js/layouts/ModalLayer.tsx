import { router } from '@inertiajs/react'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import useProjects from '@/queries/useProjects'
import AddWorkspaceModal from '@/components/AddWorkspaceModal'
import AgentEditModal from '@/components/agent/AgentEditModal'
import { GlobalSettingsModal } from '@/components/modals/GlobalSettingsModal'
import { ProjectSearchModal } from '@/components/modals/ProjectSearchModal'
import { ConfirmDeleteWorkspaceModal } from '@/components/modals/ConfirmDeleteWorkspaceModal'
import { AgentAddModal } from '@/components/modals/AgentAddModal'
import type { ProjectAgent } from '@/layouts/hooks/agents'

export function ModalLayer() {
    const { projects } = useProjects()
    const {
        // Data
        activeProject,
        // Workspace modal
        showWorkspaceModal,
        setShowWorkspaceModal,
        handleWorkspaceCreated,
        // Global settings
        showGlobalSettings,
        setShowGlobalSettings,
        agentTemplates,
        setAgentTemplates,
        // Delete workspace
        deletingWorkspace,
        setDeletingWorkspace,
        handleWorkspaceDeleted,
        // Add agent
        showAddAgent,
        setShowAddAgent,
        // Edit agent
        editingAgent,
        setEditingAgent,
        // Agent hook for mutations
        agentHook,
        // Global settings
        maxAgentsPerProject,
        // Project search
        showProjectSearch,
        setShowProjectSearch,
    } = useAppLayout()

    return (
        <>
            {/* Add workspace */}
            {showWorkspaceModal && (
                <AddWorkspaceModal
                    onClose={() => setShowWorkspaceModal(false)}
                    onCreated={() => handleWorkspaceCreated()}
                />
            )}

            {/* Global settings */}
            {showGlobalSettings && (
                <GlobalSettingsModal
                    onClose={() => setShowGlobalSettings(false)}
                    initialTemplates={agentTemplates}
                    onTemplatesChange={setAgentTemplates}
                />
            )}

            {/* Confirm delete workspace */}
            {deletingWorkspace && (
                <ConfirmDeleteWorkspaceModal
                    workspace={deletingWorkspace}
                    onClose={() => setDeletingWorkspace(null)}
                    onDeleted={_id => { handleWorkspaceDeleted(); setDeletingWorkspace(null) }}
                />
            )}

            {/* Add agent */}
            {showAddAgent && activeProject?.id != null && (
                <AgentAddModal
                    projectId={activeProject.id}
                    templates={agentTemplates}
                    agentCount={agentHook.agents.length}
                    maxAgents={maxAgentsPerProject}
                    onClose={() => setShowAddAgent(false)}
                    onCreated={(agent: ProjectAgent) => { agentHook.addAgent(agent); setShowAddAgent(false) }}
                />
            )}

            {/* Edit agent */}
            {editingAgent && (
                <AgentEditModal
                    agent={editingAgent}
                    onClose={() => setEditingAgent(null)}
                    onSaved={(updated: ProjectAgent) => {
                        agentHook.update.mutate({ agentId: updated.id, ...updated })
                        setEditingAgent(null)
                    }}
                />
            )}

            {/* Project search */}
            {showProjectSearch && (
                <ProjectSearchModal
                    projects={projects}
                    onClose={() => setShowProjectSearch(false)}
                    onSelect={project => router.visit(`/${project.slug}`)}
                />
            )}
        </>
    )
}
