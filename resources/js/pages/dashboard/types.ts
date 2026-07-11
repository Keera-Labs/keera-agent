// Prop contract served by the "/" page route as Inertia.render("Dashboard", {dashboard}).

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
    slug: string
    online: boolean
    agents: DashboardProjectAgent[]
    extraAgents: number
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
