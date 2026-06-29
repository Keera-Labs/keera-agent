import { router } from '@inertiajs/react'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import ProjectCreateModal from '@/components/project/ProjectCreateModal'
import AddWorkspaceModal from '@/components/AddWorkspaceModal'
import AgentEditModal from '@/components/agent/AgentEditModal'
import { EditProjectModal } from '@/components/modals/EditProjectModal'
import { GlobalSettingsModal } from '@/components/modals/GlobalSettingsModal'
import { ProjectSearchModal } from '@/components/modals/ProjectSearchModal'
import { ConfirmDeleteProjectModal } from '@/components/modals/ConfirmDeleteProjectModal'
import { ConfirmDeleteWorkspaceModal } from '@/components/modals/ConfirmDeleteWorkspaceModal'
import { MoveProjectModal } from '@/components/modals/MoveProjectModal'
import { AgentAddModal } from '@/components/modals/AgentAddModal'
import type { ProjectAgent } from '@/layouts/hooks/agents'

export function ModalLayer() {
    const {
        // Data
        workspaces,
        allProjects,
        activeProject,
        // Workspace modal
        showWorkspaceModal,
        setShowWorkspaceModal,
        handleWorkspaceCreated,
        // Add project modal
        addProjectWorkspaceId,
        setAddProjectWorkspaceId,
        handleProjectCreated,
        // Move project
        movingProject,
        setMovingProject,
        handleMoveProject,
        // Edit project (combined modal)
        editingProject,
        setEditingProject,
        handleProjectUpdated,
        // Global settings
        showGlobalSettings,
        setShowGlobalSettings,
        agentTemplates,
        setAgentTemplates,
        // Delete project
        deletingProject,
        setDeletingProject,
        handleProjectDeleted,
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
                    onCreated={handleWorkspaceCreated}
                />
            )}

            {/* Create project */}
            {addProjectWorkspaceId !== undefined && (
                <ProjectCreateModal
                    workspaces={workspaces}
                    defaultWorkspaceId={addProjectWorkspaceId}
                    onClose={() => setAddProjectWorkspaceId(undefined)}
                    onCreated={handleProjectCreated}
                />
            )}

            {/* Move project */}
            {movingProject && (
                <MoveProjectModal
                    project={movingProject}
                    workspaces={workspaces}
                    onClose={() => setMovingProject(null)}
                    onMove={handleMoveProject}
                />
            )}

            {/* Edit project (path + system instructions + permissions) */}
            {editingProject && (
                <EditProjectModal
                    project={editingProject}
                    onClose={() => setEditingProject(null)}
                    onUpdated={p => handleProjectUpdated(p)}
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

            {/* Confirm delete project */}
            {deletingProject && (
                <ConfirmDeleteProjectModal
                    project={deletingProject}
                    onClose={() => setDeletingProject(null)}
                    onDeleted={id => { handleProjectDeleted(id); setDeletingProject(null) }}
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
                    projects={allProjects}
                    onClose={() => setShowProjectSearch(false)}
                    onSelect={project => router.visit(`/${project.slug}`)}
                />
            )}
        </>
    )
}
