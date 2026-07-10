// UI-first placeholder data for the Dashboard overview.
// Shaped so a real workspace-aggregation endpoint can drop in later
// (see plan: backend + new agent states are a follow-up).

export interface DashboardWorkingAgent {
    id: number
    name: string
    initials: string
    agentType: string
    role: string
    description: string
    project: string
    elapsed: string
}

export interface DashboardProjectAgent {
    initials: string
    agentType: string
}

export interface DashboardProject {
    id: number
    name: string
    online: boolean
    agents: DashboardProjectAgent[]
    extraAgents?: number
    activeCount: number
    waitingCount: number
    queuedCount: number
    doneCount: number
    lastActivity: string
}

export interface DashboardData {
    workspaceName: string
    agentCount: number
    projectCount: number
    stats: { projects: number; active: number; waiting: number; queued: number }
    workingNow: DashboardWorkingAgent[]
    projects: DashboardProject[]
}

export const dashboardPlaceholder: DashboardData = {
    workspaceName: 'Personal Workspace',
    agentCount: 16,
    projectCount: 14,
    stats: { projects: 14, active: 16, waiting: 3, queued: 1 },
    workingNow: [
        { id: 1, name: 'PM', initials: 'PM', agentType: 'pm', role: 'Project Manager', description: 'Planning the v2 milestone breakdown and assigning epics.', project: 'Keera Agent', elapsed: '8m 12s' },
        { id: 2, name: 'PM', initials: 'PM', agentType: 'pm', role: 'Project Manager', description: 'Coordinating the PR75 rebase and merge once CI is green.', project: 'Framework', elapsed: '12m 40s' },
        { id: 3, name: 'Reviewer PR75', initials: 'RE', agentType: 'reviewer', role: 'Code Reviewer', description: 'Reviewing dependency + config changes on PR75 before merge.', project: 'Framework', elapsed: '2m 24s' },
        { id: 4, name: 'Orchestrator', initials: 'OR', agentType: 'orchestrator', role: 'Orchestrator', description: 'Dispatching sub-tasks to worker agents and tracking status.', project: 'Framework', elapsed: '34m 02s' },
        { id: 5, name: 'Test Runner', initials: 'TO', agentType: 'qa', role: 'Tester', description: 'Running the pytest suite — 486 passed / 7 skipped.', project: 'Framework', elapsed: '1m 11s' },
    ],
    projects: [
        { id: 1, name: 'Keera Agent', online: true, agents: [{ initials: 'PM', agentType: 'pm' }, { initials: 'SC', agentType: 'software_engineer' }], activeCount: 1, waitingCount: 1, queuedCount: 0, doneCount: 0, lastActivity: '2m ago' },
        { id: 2, name: 'Framework', online: true, agents: [{ initials: 'PM', agentType: 'pm' }, { initials: 'RE', agentType: 'reviewer' }, { initials: 'OR', agentType: 'orchestrator' }, { initials: 'TO', agentType: 'qa' }], extraAgents: 1, activeCount: 4, waitingCount: 0, queuedCount: 1, doneCount: 0, lastActivity: 'just now' },
        { id: 3, name: 'XG-Boost', online: true, agents: [{ initials: 'BE', agentType: 'software_engineer' }, { initials: 'TO', agentType: 'qa' }], activeCount: 1, waitingCount: 0, queuedCount: 0, doneCount: 1, lastActivity: '6m ago' },
        { id: 4, name: 'Duolingo', online: true, agents: [{ initials: 'FA', agentType: 'software_engineer' }], activeCount: 1, waitingCount: 0, queuedCount: 0, doneCount: 0, lastActivity: '11m ago' },
        { id: 5, name: 'Keera Team', online: true, agents: [{ initials: 'PM', agentType: 'pm' }], activeCount: 1, waitingCount: 0, queuedCount: 0, doneCount: 0, lastActivity: '1h ago' },
        { id: 6, name: 'Agents', online: true, agents: [{ initials: 'OR', agentType: 'orchestrator' }, { initials: 'BE', agentType: 'software_engineer' }], activeCount: 1, waitingCount: 1, queuedCount: 0, doneCount: 0, lastActivity: 'just now' },
        { id: 7, name: 'CA-JoBins', online: false, agents: [{ initials: 'SC', agentType: 'software_engineer' }], activeCount: 0, waitingCount: 0, queuedCount: 0, doneCount: 1, lastActivity: '34m ago' },
        { id: 8, name: 'Assistant', online: true, agents: [{ initials: 'PM', agentType: 'pm' }, { initials: 'FA', agentType: 'software_engineer' }], activeCount: 2, waitingCount: 0, queuedCount: 0, doneCount: 0, lastActivity: 'just now' },
        { id: 9, name: 'AI-Python', online: true, agents: [{ initials: 'BE', agentType: 'software_engineer' }], activeCount: 1, waitingCount: 0, queuedCount: 0, doneCount: 0, lastActivity: '8m ago' },
        { id: 10, name: 'JH-AI', online: true, agents: [{ initials: 'TO', agentType: 'qa' }], activeCount: 1, waitingCount: 0, queuedCount: 0, doneCount: 0, lastActivity: '22m ago' },
        { id: 11, name: 'Salut AI', online: true, agents: [{ initials: 'FA', agentType: 'software_engineer' }, { initials: 'DS', agentType: 'software_engineer' }], activeCount: 1, waitingCount: 1, queuedCount: 0, doneCount: 0, lastActivity: 'just now' },
        { id: 12, name: 'Jira', online: false, agents: [{ initials: 'PM', agentType: 'pm' }], activeCount: 0, waitingCount: 0, queuedCount: 0, doneCount: 1, lastActivity: '2h ago' },
        { id: 13, name: 'AI-backend', online: true, agents: [{ initials: 'BE', agentType: 'software_engineer' }], activeCount: 1, waitingCount: 0, queuedCount: 0, doneCount: 0, lastActivity: '3m ago' },
        { id: 14, name: 'AI-Frontend', online: true, agents: [{ initials: 'FA', agentType: 'software_engineer' }], activeCount: 1, waitingCount: 0, queuedCount: 0, doneCount: 0, lastActivity: '5m ago' },
    ],
}
