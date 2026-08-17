import { router } from '@inertiajs/react'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import useAllProjects from '@/queries/allProjectsQuery'
import { GlobalSettingsModal } from '@/components/modals/GlobalSettingsModal'
import { ProjectSearchModal } from '@/components/modals/ProjectSearchModal'
import { ConfirmDeleteWorkspaceModal } from '@/components/modals/ConfirmDeleteWorkspaceModal'

export function ModalLayer() {
    const {
        // Global settings
        showGlobalSettings,
        setShowGlobalSettings,
        agentTemplates,
        setAgentTemplates,
        // Delete workspace
        handleWorkspaceDeleted,
        // Project search
        showProjectSearch,
        setShowProjectSearch,
    } = useAppLayout()
    const deletingWorkspace = useWorkspaceStore(s => s.deletingWorkspace)
    const setDeletingWorkspace = useWorkspaceStore(s => s.setDeletingWorkspace)
    const searchProjects = useAllProjects(showProjectSearch)

    return (
        <>
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
                    projects={searchProjects}
                    onClose={() => setShowProjectSearch(false)}
                    onSelect={project => router.visit(`/${project.slug}`)}
                />
            )}
        </>
    )
}
