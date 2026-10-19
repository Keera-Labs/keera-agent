// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import CommandsPanel from '@/components/commands/CommandsPanel.vue'
import { useCommandRunStore } from '@/stores/commandRunStore'
import Configurations from './Configurations.vue'

vi.mock('@/composables/useTerminalSessions', () => ({}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))

const worktree = (path: string, extra: Record<string, unknown> = {}) => ({
    path, branch: path.split('/').pop(), head: null, detached: false, is_main: false, is_current: false,
    locked: false, prunable: false, agent_id: null, agent_name: null, ...extra,
})

const respond = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url === '/api/projects/7/git/worktrees') {
            return respond({
                worktrees: [
                    worktree('/repo', { is_main: true, is_current: true }),
                    worktree('/repo/.claude/worktrees/agent-3', { agent_id: 3 }),
                    worktree('/gone', { prunable: true }),
                ],
            })
        }
        return respond({ data: [{ type: 'commands', id: '1', attributes: { project_id: 7, label: 'dev', command: 'npm run dev', kind: 'run', run: null } }] })
    }))
})

afterEach(() => vi.unstubAllGlobals())

function mountPage(project_id: number | null) {
    const pinia = createPinia()
    const w = mount(Configurations, { props: { project: 'acme-web', project_id }, global: { plugins: [pinia, PiniaColada] } })
    return { w, runs: useCommandRunStore(pinia) }
}

describe('Configurations page', () => {
    it('renders the commands panel for the routed project', async () => {
        const { w } = mountPage(7)
        await flushPromises()

        expect(w.getComponent(CommandsPanel).props()).toEqual({ projectId: 7 })
        expect(w.text()).toContain('/dev')
    })

    it('chooses the worktree the Run menu uses from the live, linked worktrees', async () => {
        const { w, runs } = mountPage(7)
        await flushPromises()

        const select = w.get('[data-testid="command-worktree-select"]')
        expect(select.findAll('option').map(o => o.text())).toEqual(['root', 'agent-3 (agent-3)'])

        await select.setValue('/repo/.claude/worktrees/agent-3')
        expect(runs.selectedWorktrees[7]).toBe('/repo/.claude/worktrees/agent-3')

        await select.setValue('')
        expect(runs.selectedWorktrees[7]).toBeNull()
    })

    it('says so when the project does not exist', () => {
        const { w } = mountPage(null)

        expect(w.text()).toContain('Project not found')
        expect(w.findComponent(CommandsPanel).exists()).toBe(false)
    })
})
