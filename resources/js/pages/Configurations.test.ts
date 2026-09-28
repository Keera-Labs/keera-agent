// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandsPanel from '@/components/commands/CommandsPanel.vue'
import type { Command } from '@/components/commands/types'
import Configurations from './Configurations.vue'

describe('Configurations page', () => {
    it('renders the shared commands panel for the routed project', () => {
        const commands: Command[] = [{ id: 1, project_id: 7, label: 'dev', command: 'npm run dev', description: '', category: '', shortcut: '', status: 'stopped', pid: null }]
        const w = mount(Configurations, { props: { project: 'acme-web', project_id: 7, commands } })

        expect(w.getComponent(CommandsPanel).props()).toEqual({ projectId: 7, projectSlug: 'acme-web', initialCommands: commands })
        expect(w.text()).toContain('/dev')
    })

    it('says so when the project does not exist', () => {
        const w = mount(Configurations, { props: { project: 'missing', project_id: null } })

        expect(w.text()).toContain('Project not found')
        expect(w.findComponent(CommandsPanel).exists()).toBe(false)
    })
})
