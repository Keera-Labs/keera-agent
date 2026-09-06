import { describe, expect, it } from 'vitest'
import { agentCreatePayload } from './AgentAddModal'
import { modelForProviderComplexity } from '@/types/provider'

describe('agent provider complexity model selection', () => {
    it.each([
        ['codex', 'easy', 'gpt-5.6-luna'],
        ['codex', 'medium', 'gpt-5.6-terra'],
        ['codex', 'hard', 'gpt-5.6-sol'],
        ['claude', 'easy', 'claude-sonnet-5'],
        ['claude', 'medium', 'claude-opus-5'],
        ['claude', 'hard', 'claude-fable-5'],
    ])('maps %s %s work to %s', (provider, complexity, model) => {
        expect(modelForProviderComplexity(provider, complexity)).toBe(model)
    })

    it('submits the derived Claude model with the provider and complexity', () => {
        expect(agentCreatePayload({
            name: 'Reviewer',
            agentType: 'code_reviewer',
            description: 'Reviews pull requests',
            provider: 'claude',
            systemPrompt: 'Review carefully.',
            complexity: 'hard',
            flags: {},
            planMode: false,
        })).toMatchObject({
            provider: 'claude',
            complexity: 'hard',
            model: 'claude-fable-5',
        })
    })
})
