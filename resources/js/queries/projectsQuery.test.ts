// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createApp, reactive } from 'vue'
import { installPinia, project, stubFetch } from '@/pages/agents/testing'
import { useEditorStore } from '@/stores/editorStore'
import useProjects from './projectsQuery'

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => reactive({ component: 'Home', props: { project: 'keera' } }),
    router: { visit: vi.fn(), on: vi.fn(() => () => {}) },
}))

afterEach(() => vi.unstubAllGlobals())

describe('useProjects', () => {
    it('closes the deleted project\'s editor tabs', async () => {
        stubFetch({ '/api/projects': [project] })
        const app = createApp({ render: () => null })
        const [pinia, colada] = installPinia()
        app.use(pinia).use(colada)
        const projects = app.runWithContext(() => useProjects())
        const editor = useEditorStore()
        const closeProject = vi.spyOn(editor, 'closeProject')

        await projects.handleProjectDeleted(project.id)
        await flushPromises()

        expect(closeProject).toHaveBeenCalledWith(project.id)
    })
})
