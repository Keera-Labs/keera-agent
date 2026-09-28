import type { Task } from '@/types/type'

export function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 1,
        project_id: 1,
        title: 'Write docs',
        body: null,
        priority: 'medium',
        assignees: [],
        acceptance_criteria: [],
        testing_methods: [],
        validation_steps: [],
        status: 'pending',
        pr_number: null,
        pr_url: null,
        branch: null,
        additions: null,
        deletions: null,
        review_note: null,
        progress_step: null,
        progress_total: null,
        created_at: '2026-01-01T00:00:00Z',
        completed_at: null,
        ...overrides,
    }
}
