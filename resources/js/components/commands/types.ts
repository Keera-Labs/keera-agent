// Prop contract served by the "/{project}/configurations" route as
// Inertia.render("Configurations", { project, project_id, commands }).

export interface Command {
    id: number
    project_id: number
    label: string
    command: string
    description: string
    category: string
    shortcut: string
    status: 'running' | 'stopped'
    pid: number | null
}
