import { create } from 'zustand'
import type { Project } from '@/types/type'

interface ProjectState {
    // The active project, derived once in AppLayoutContext from the URL slug
    // and the projects list. A store (not context) so any component can read
    // it without subscribing to the rest of AppLayoutContext's re-renders.
    activeProject: Project | null
    setActiveProject: (project: Project | null) => void
}

export const useProjectStore = create<ProjectState>()(set => ({
    activeProject: null,
    setActiveProject: project => set({ activeProject: project }),
}))
