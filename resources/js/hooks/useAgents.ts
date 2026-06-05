import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

export interface ProjectAgent {
    id: number
    project_id: number
    name: string
    description: string | null
    model: string
    system_prompt: string | null
    agent_type: string
    status: 'idle' | 'running'
    task_id?: number | null
    created_at: string | null
}

export interface AgentSession {
    term: Terminal
    ws: WebSocket
    fitAddon: FitAddon
    observer: ResizeObserver
}

export function useAgents(projectId: number | null, projectSlug: string | null) {
    const [agents, setAgents] = useState<ProjectAgent[]>([])
    const [activeAgentId, setActiveAgentId] = useState<number | null>(null)
    const sessions = useRef<Map<number, AgentSession>>(new Map())
    const containerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())

    useEffect(() => {
        if (!projectId) { setAgents([]); return }
        setActiveAgentId(null)
        sessions.current.forEach(({ term, ws, observer }) => {
            observer.disconnect(); term.dispose(); ws.close()
        })
        sessions.current.clear()
        fetch(`/api/projects/${projectId}/agents`)
            .then(r => r.json())
            .then(setAgents)
            .catch(() => {})
    }, [projectId])

    useEffect(() => {
        return () => {
            sessions.current.forEach(({ term, ws, observer }) => {
                observer.disconnect(); term.dispose(); ws.close()
            })
        }
    }, [])

    async function createAgent(projectId: number, body: Partial<ProjectAgent> & { name: string }): Promise<ProjectAgent | null> {
        const res = await fetch(`/api/projects/${projectId}/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        if (!res.ok) return null
        const agent: ProjectAgent = await res.json()
        setAgents(prev => [...prev, agent])
        return agent
    }

    async function spawnAgentViaMCP(
        projectPath: string,
        name: string,
        agentType: string,
        message: string,
        taskId?: number,
    ): Promise<{ success: boolean; text: string }> {
        const res = await fetch('/mcp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Project-Path': projectPath,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: {
                    name: 'spawn_agent',
                    arguments: {
                        project_path: projectPath,
                        name,
                        agent_type: agentType,
                        message,
                        ...(taskId != null ? { task_id: taskId } : {}),
                    },
                },
            }),
        })
        const data = await res.json()
        const text: string = data?.result?.content?.[0]?.text ?? data?.error?.message ?? 'Unknown response'
        return { success: !data.error, text }
    }

    return {
        agents,
        setAgents,
        activeAgentId,
        setActiveAgentId,
        sessions,
        containerRefs,
        createAgent,
        spawnAgentViaMCP,
    }
}
