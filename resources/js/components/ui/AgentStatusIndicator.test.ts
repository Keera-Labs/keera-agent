// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentStatusIndicator from './AgentStatusIndicator.vue'

const render = (status: string | null) =>
    mount(AgentStatusIndicator, { props: { status: status as never } }).get('[data-testid="agent-status-indicator"]')

describe('AgentStatusIndicator', () => {
    it.each([
        ['running', 'Working'],
        ['needs_input', 'Needs input'],
        ['waiting', 'Waiting'],
        ['idle', 'Idle'],
    ])('labels %s as %s', (status, label) => {
        const indicator = render(status)

        expect(indicator.attributes('data-status')).toBe(status)
        expect(indicator.attributes('aria-label')).toBe(label)
    })

    it('spins only when motion is allowed and stays a closed ring under reduced motion', () => {
        const ring = render('running').get('span')

        expect(ring.classes()).toContain('motion-safe:animate-spin')
        expect(ring.classes()).not.toContain('animate-spin')
        expect(ring.classes()).toContain('motion-reduce:border-success')
    })

    it('marks a needs-input agent with a question mark', () => {
        expect(render('needs_input').text()).toBe('?')
    })

    it('treats a missing or unknown status as idle', () => {
        expect(render(null).attributes('data-status')).toBe('idle')
        expect(render('bogus').attributes('data-status')).toBe('idle')
    })
})
