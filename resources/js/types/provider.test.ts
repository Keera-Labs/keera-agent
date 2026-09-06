import { describe, expect, it } from 'vitest'
import { reconcileComplexityModels } from './provider'

describe('reconcileComplexityModels', () => {
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
