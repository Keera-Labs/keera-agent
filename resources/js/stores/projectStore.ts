import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { Project } from '@/types/type'

export const useProjectStore = defineStore('project', () => {
    // Resolved once from the URL slug and the projects list by the project
    // layout. A store (not provide/inject) so any component can read it.
    const activeProject = shallowRef<Project | null>(null)

    function setActiveProject(project: Project | null) {
        activeProject.value = project
    }

    return { activeProject, setActiveProject }
})
