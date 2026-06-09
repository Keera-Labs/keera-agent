export interface Workspace {
    id: number
    name: string
    description: string | null
    projects: Project[]
}

export interface Project {
    id: number
    name: string
    slug: string
    path: string
    language: string
    workspace_id: number | null
    claude_status: 'running' | 'idle' | null
    system_prompt: string | null
}

export interface Task {
    id: number
    project_id: number
    title: string
    body: string | null
    priority: 'low' | 'medium' | 'high'
    assignees: string[]
    acceptance_criteria: string[]
    testing_methods: string[]
    validation_steps: string[]
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    created_at: string
    completed_at: string | null
}
