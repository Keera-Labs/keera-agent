import AppLayout from '@/layouts/AppLayout'
import { ProjectLayout } from '@/layouts/ProjectLayout'

// Agent detail — served at /{project}/agents/{id} via Inertia (agent_id prop).
//
// This page is intentionally empty: the agent's terminal is rendered by the
// persistent ProjectLayout → AgentsIndex, driven by the agent_id prop →
// activeAgentId. Keeping the terminal in the persistent layers is what lets the
// PTY sessions/WebSockets in AppLayout's useRef maps survive navigation. Moving
// the terminal DOM into this page would unmount it on navigation and blank the
// session, so the page owns no terminal markup.
export default function AgentDetail() {
    return null
}

// Nested persistent layouts — same refs as Home/Tasks so Inertia preserves them
// across navigation (and with them the live terminal). Unlike Dashboard, the
// agent page needs ProjectLayout too, since that's where the terminal lives.
AgentDetail.layout = [AppLayout, ProjectLayout]
