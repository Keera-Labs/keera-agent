import { useEffect, useState } from 'react'

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

export function useWorkspaces() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [allProjects, setAllProjects] = useState<Project[]>([])
    const [claudeStatus, setClaudeStatus] = useState<Record<number, 'running' | 'done'>>({})

    useEffect(() => {
        Promise.all([
            fetch('/api/workspaces').then(r => r.json()),
            fetch('/api/projects').then(r => r.json()),
        ]).then(([ws, ps]: [Workspace[], Project[]]) => {
            setWorkspaces(ws)
            setAllProjects(ps)
            const initial: Record<number, 'running' | 'done'> = {}
            for (const p of ps) {
                if (p.claude_status === 'running') initial[p.id] = 'running'
                else if (p.claude_status === 'idle') initial[p.id] = 'done'
            }
            setClaudeStatus(initial)
        }).catch(() => {})
    }, [])

    function handleWorkspaceCreated(workspace: Workspace) {
        setWorkspaces(prev => [...prev, workspace])
    }

    function handleWorkspaceDeleted(workspaceId: number) {
        setWorkspaces(prev => prev.filter(w => w.id !== workspaceId))
        setAllProjects(prev => prev.map(p =>
            p.workspace_id === workspaceId ? { ...p, workspace_id: null } : p
        ))
    }

    function handleProjectCreated(project: Project) {
        setAllProjects(prev => [...prev, project])
        if (project.workspace_id !== null && project.workspace_id !== undefined) {
            setWorkspaces(prev => prev.map(w =>
                w.id === project.workspace_id
                    ? { ...w, projects: [...w.projects, project] }
                    : w
            ))
        }
    }

    function handleProjectUpdated(updated: Project) {
        setAllProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
        setWorkspaces(prev => prev.map(w => ({
            ...w,
            projects: w.projects.map(p => p.id === updated.id ? updated : p),
        })))
    }

    function handleProjectDeleted(projectId: number) {
        setAllProjects(prev => prev.filter(p => p.id !== projectId))
        setWorkspaces(prev => prev.map(w => ({
            ...w,
            projects: w.projects.filter(p => p.id !== projectId),
        })))
    }

    async function handleMoveProject(project: Project, newWorkspaceId: number | null) {
        const res = await fetch(`/api/projects/${project.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_id: newWorkspaceId }),
        })
        if (!res.ok) throw new Error('Failed to move project')
        const updated: Project = await res.json()
        setAllProjects(prev => prev.map(p => p.id === project.id ? updated : p))
        setWorkspaces(prev => prev.map(w => {
            if (w.id === project.workspace_id) {
                return { ...w, projects: w.projects.filter(p => p.id !== project.id) }
            }
            if (w.id === newWorkspaceId) {
                return { ...w, projects: [...w.projects, updated] }
            }
            return w
        }))
    }

    const unassignedProjects = allProjects.filter(p => p.workspace_id === null || p.workspace_id === undefined)

    return {
        workspaces,
        setWorkspaces,
        allProjects,
        setAllProjects,
        claudeStatus,
        setClaudeStatus,
        unassignedProjects,
        handleWorkspaceCreated,
        handleWorkspaceDeleted,
        handleProjectCreated,
        handleProjectUpdated,
        handleProjectDeleted,
        handleMoveProject,
    }
}
