import { describe, expect, it } from 'vitest'
import { FALLBACK_PROVIDERS, modelForProviderComplexity, modelsForProvider, reconcileComplexityModels } from './provider'

describe('reconcileComplexityModels', () => {
    it('offers Gemini models and resolves its complexity defaults', () => {
        expect(modelsForProvider(FALLBACK_PROVIDERS, 'gemini')).toEqual(['gemini-3.8-flash'])
        expect(modelForProviderComplexity('gemini', 'easy')).toBe('gemini-3.8-flash')
        expect(modelForProviderComplexity('gemini', 'hard')).toBe('gemini-3.8-flash')
    })
    it('replaces stale selections after the configured provider models change', () => {
        const modelsAfterEdit = ['codex-fast', 'codex-careful']
        const submittedComplexityModels = reconcileComplexityModels('codex', modelsAfterEdit, {
            easy: 'gpt-5.6-luna',
            medium: 'gpt-5.6-terra',
            hard: 'gpt-5.6-sol',
        })

        expect(Object.values(submittedComplexityModels).every(model => modelsAfterEdit.includes(model))).toBe(true)
    })
})
