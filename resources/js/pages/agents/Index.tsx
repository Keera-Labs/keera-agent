import AppLayout from '@/layouts/AppLayout'
import { ProjectLayout } from '@/layouts/ProjectLayout'

// This page is rendered by the backend at /{project}/agents/{agent_id}.
// The active agent is selected via the agent_id prop injected into AppLayoutContext.
export default function AgentIndex() {
    return null
}

AgentIndex.layout = [AppLayout, ProjectLayout]
