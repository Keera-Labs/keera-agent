import { useState, useEffect } from 'react'
import { color } from '@/tokens'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentMessage {
    id: number
    sender_project_id: number
    receiver_project_id: number
    sender_name: string
    receiver_name: string
    content: string
    status: 'pending' | 'delivered' | 'read'
    created_at: string
}

// ─── Messages view ────────────────────────────────────────────────────────────

export function MessagesView({ projectId, projectName, newMessageIds }: { projectId: number; projectName: string; newMessageIds: number[] }) {
    const [messages, setMessages] = useState<AgentMessage[]>([])

    useEffect(() => {
        fetch(`/api/projects/${projectId}/messages`)
            .then(r => r.json())
            .then(setMessages)
            .catch(() => {})
    }, [projectId])

    // Reload when new messages arrive via WS
    useEffect(() => {
        if (newMessageIds.length === 0) return
        fetch(`/api/projects/${projectId}/messages`)
            .then(r => r.json())
            .then(setMessages)
            .catch(() => {})
    }, [newMessageIds.length, projectId])

    async function markRead(msg: AgentMessage) {
        if (msg.status === 'read') return
        await fetch(`/api/messages/${msg.id}/read`, { method: 'PATCH' })
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'read' } : m))
    }

    const unreadCount = messages.filter(m => m.receiver_project_id === projectId && m.status !== 'read').length

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                padding: '10px 20px', borderBottom: `1px solid ${color.border}`,
                display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                background: color.bgCanvas,
            }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill={color.textMuted}>
                    <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 14H1.75A1.75 1.75 0 010 12.25v-8.5C0 2.784.784 2 1.75 2zM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V5.06l-5.563 3.516a1.75 1.75 0 01-1.874 0L1.5 5.06v7.19zm13-8.181L8.312 7.512a.25.25 0 01-.264 0L1.5 4.07v-.32a.25.25 0 01.25-.25h12.5a.25.25 0 01.25.25v.32z"/>
                </svg>
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, flex: 1 }}>Agent Messages</span>
                {unreadCount > 0 && (
                    <span style={{
                        fontSize: '10px', padding: '1px 7px', borderRadius: '10px',
                        background: `${color.accent}20`, border: `1px solid ${color.accent}40`,
                        color: color.accent,
                    }}>
                        {unreadCount} unread
                    </span>
                )}
            </div>

            {/* Message thread */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {messages.length === 0 ? (
                    <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '10px',
                        padding: '60px 24px', textAlign: 'center',
                    }}>
                        <svg width="32" height="32" viewBox="0 0 16 16" fill={color.textFaint}>
                            <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 14H1.75A1.75 1.75 0 010 12.25v-8.5C0 2.784.784 2 1.75 2zM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V5.06l-5.563 3.516a1.75 1.75 0 01-1.874 0L1.5 5.06v7.19zm13-8.181L8.312 7.512a.25.25 0 01-.264 0L1.5 4.07v-.32a.25.25 0 01.25-.25h12.5a.25.25 0 01.25.25v.32z"/>
                        </svg>
                        <div>
                            <p style={{ margin: '0 0 4px', color: color.textSecondary, fontSize: '13px', fontWeight: 500 }}>
                                No messages yet
                            </p>
                            <p style={{ margin: 0, color: color.textFaint, fontSize: '11px', lineHeight: 1.5 }}>
                                Agents can communicate using the<br />
                                <code style={{ fontFamily: '"JetBrains Mono", monospace', color: color.accent }}>send_message_to_agent</code> MCP tool
                            </p>
                        </div>
                    </div>
                ) : (
                    messages.map(msg => {
                        const isInbound = msg.receiver_project_id === projectId
                        const isUnread = isInbound && msg.status !== 'read'
                        return (
                            <div
                                key={msg.id}
                                onClick={() => isInbound && markRead(msg)}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: isInbound ? 'flex-start' : 'flex-end',
                                    gap: '4px',
                                    cursor: isUnread ? 'pointer' : 'default',
                                }}
                            >
                                <div style={{
                                    fontSize: '10px', color: color.textFaint,
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                }}>
                                    {isInbound ? (
                                        <><span style={{ color: color.accent }}>{msg.sender_name}</span> → {projectName}</>
                                    ) : (
                                        <>{projectName} → <span style={{ color: color.accent }}>{msg.receiver_name}</span></>
                                    )}
                                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div style={{
                                    maxWidth: '75%',
                                    background: isInbound ? color.bgSurface : color.accentSubtle,
                                    border: `1px solid ${isUnread ? color.accent : isInbound ? color.borderMuted : color.accentEmphasis}`,
                                    borderRadius: '8px',
                                    padding: '8px 12px',
                                    fontSize: '12px',
                                    color: color.textPrimary,
                                    lineHeight: 1.5,
                                    wordBreak: 'break-word',
                                    whiteSpace: 'pre-wrap',
                                    boxShadow: isUnread ? `0 0 0 2px ${color.accent}30` : 'none',
                                }}>
                                    {msg.content}
                                    {isUnread && (
                                        <span style={{
                                            display: 'inline-block', marginLeft: '6px',
                                            width: '6px', height: '6px', borderRadius: '50%',
                                            background: color.accent, verticalAlign: 'middle',
                                        }} />
                                    )}
                                </div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>
                                    {msg.status}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
