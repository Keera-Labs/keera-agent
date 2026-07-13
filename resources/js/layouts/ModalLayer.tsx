import { router } from '@inertiajs/react'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import useProjects from '@/queries/projectsQuery'
import AddWorkspaceModal from '@/components/AddWorkspaceModal'
import { GlobalSettingsModal } from '@/components/modals/GlobalSettingsModal'
import { ProjectSearchModal } from '@/components/modals/ProjectSearchModal'
import { ConfirmDeleteWorkspaceModal } from '@/components/modals/ConfirmDeleteWorkspaceModal'

export function ModalLayer() {
    const { projects } = useProjects()
    const {
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
