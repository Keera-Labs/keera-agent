import { useEffect, useRef, useState } from 'react'
import Pusher, { type Channel } from 'pusher-js'
import AppLayout from '@/layouts/AppLayout'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BroadcastMessage {
    id: number
    event: string
    data: Record<string, unknown>
    receivedAt: Date
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

const CHANNEL_NAME = 'broadcasting-poc'

// ─── Component ────────────────────────────────────────────────────────────────

export default function Broadcasting() {
    const [status, setStatus] = useState<ConnectionStatus>('connecting')
    const [messages, setMessages] = useState<BroadcastMessage[]>([])
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [idCounter, setIdCounter] = useState(0)

    const pusherRef = useRef<Pusher | null>(null)
    const channelRef = useRef<Channel | null>(null)
    const bottomRef = useRef<HTMLDivElement | null>(null)

    // ── WebSocket / Pusher setup ────────────────────────────────────────────
    useEffect(() => {
        const { hostname, port } = window.location

        const pusher = new Pusher('local', {
            wsHost: hostname,
            wsPort: port ? Number(port) : 80,
            forceTLS: false,
            enabledTransports: ['ws'],
            cluster: 'mt1',
            wsPath: '/reverb',
        })

        pusherRef.current = pusher

        pusher.connection.bind('connecting', () => setStatus('connecting'))
        pusher.connection.bind('connected', () => {
            setStatus('connected')
            setError(null)
        })
        pusher.connection.bind('disconnected', () => setStatus('disconnected'))
        pusher.connection.bind('error', (err: unknown) => {
            setStatus('error')
            setError(String(err))
        })

        const channel = pusher.subscribe(CHANNEL_NAME)
        channelRef.current = channel

        // Catch-all: log every non-lifecycle event on this channel
        channel.bind_global((eventName: string, data: Record<string, unknown>) => {
            if (eventName.startsWith('pusher:') || eventName.startsWith('pusher_internal:')) return
            setIdCounter(prev => {
                const nextId = prev + 1
                setMessages(msgs => [
                    ...msgs,
                    { id: nextId, event: eventName, data, receivedAt: new Date() },
                ])
                return nextId
            })
        })

        return () => {
            channel.unbind_all()
            pusher.unsubscribe(CHANNEL_NAME)
            pusher.disconnect()
            pusherRef.current = null
            channelRef.current = null
        }
    }, [])

    // Auto-scroll to newest message
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // ── Ping handler ────────────────────────────────────────────────────────
    async function handlePing() {
        const msg = input.trim() || 'ping'
        setSending(true)
        setError(null)
        try {
            const res = await fetch('/api/broadcasting/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg }),
            })
            if (!res.ok) {
                const text = await res.text()
                setError(`Server error ${res.status}: ${text}`)
            } else {
                setInput('')
            }
        } catch (e) {
            setError(`Fetch failed: ${e}`)
        } finally {
            setSending(false)
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') handlePing()
    }

    // ── Status badge ────────────────────────────────────────────────────────
    const statusColors: Record<ConnectionStatus, { bg: string; text: string; dot: string }> = {
        connecting:   { bg: '#fef9c3', text: '#a16207', dot: '#eab308' },
        connected:    { bg: '#dcfce7', text: '#15803d', dot: '#22c55e' },
        disconnected: { bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8' },
        error:        { bg: '#fee2e2', text: '#b91c1c', dot: '#ef4444' },
    }
    const sc = statusColors[status]

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxWidth: '720px',
            margin: '0 auto',
            padding: '32px 24px',
            gap: '24px',
            boxSizing: 'border-box',
        }}>
            {/* ── Header ──────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111' }}>
                    Broadcasting POC
                </h1>

                {/* Connection status badge */}
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '3px 10px', borderRadius: '999px',
                    background: sc.bg, color: sc.text,
                    fontSize: '12px', fontWeight: 600,
                }}>
                    <span style={{
                        width: '7px', height: '7px', borderRadius: '50%',
                        background: sc.dot,
                        boxShadow: status === 'connected' ? `0 0 0 2px ${sc.dot}40` : 'none',
                    }} />
                    {status}
                </span>

                <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: 'auto' }}>
                    channel: <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>{CHANNEL_NAME}</code>
                </span>
            </div>

            {/* ── Description ─────────────────────────────────────────── */}
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b', lineHeight: 1.6 }}>
                This page proves the full broadcast pipeline:{' '}
                <strong>HTTP POST → server broadcasts event → Reverb WebSocket → UI updates live.</strong>{' '}
                Type a message and click <strong>Ping</strong>; the event should appear in the log below within
                milliseconds.
            </p>

            {/* ── Input + button ──────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: '8px' }}>
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder='Message (default: "ping")'
                    disabled={sending}
                    style={{
                        flex: 1,
                        padding: '8px 12px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        fontSize: '14px',
                        color: '#1e293b',
                        background: '#fff',
                        outline: 'none',
                    }}
                />
                <button
                    onClick={handlePing}
                    disabled={sending || status !== 'connected'}
                    style={{
                        padding: '8px 20px',
                        borderRadius: '6px',
                        border: 'none',
                        background: sending || status !== 'connected' ? '#94a3b8' : '#6c47ff',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '14px',
                        cursor: sending || status !== 'connected' ? 'not-allowed' : 'pointer',
                        transition: 'background 0.15s',
                    }}
                >
                    {sending ? 'Sending…' : 'Ping'}
                </button>
            </div>

            {/* ── Error ───────────────────────────────────────────────── */}
            {error && (
                <div style={{
                    padding: '8px 12px',
                    background: '#fee2e2',
                    border: '1px solid #fca5a5',
                    borderRadius: '6px',
                    color: '#b91c1c',
                    fontSize: '13px',
                }}>
                    ⚠ {error}
                </div>
            )}

            {/* ── Event log ───────────────────────────────────────────── */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                background: '#f8fafc',
                minHeight: '200px',
            }}>
                {messages.length === 0 ? (
                    <div style={{
                        padding: '32px',
                        textAlign: 'center',
                        color: '#94a3b8',
                        fontSize: '13px',
                    }}>
                        {status === 'connected'
                            ? 'No events yet — click Ping to send one.'
                            : 'Waiting for WebSocket connection…'}
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, width: '40px' }}>#</th>
                                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Event</th>
                                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Data</th>
                                <th style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>Received at</th>
                            </tr>
                        </thead>
                        <tbody>
                            {messages.map(msg => (
                                <tr key={msg.id} style={{ borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
                                    <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{msg.id}</td>
                                    <td style={{ padding: '8px 12px' }}>
                                        <code style={{
                                            background: '#ede9fe',
                                            color: '#6c47ff',
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            fontWeight: 600,
                                        }}>
                                            {msg.event}
                                        </code>
                                    </td>
                                    <td style={{ padding: '8px 12px', color: '#374151', wordBreak: 'break-word' }}>
                                        {typeof msg.data?.message === 'string'
                                            ? msg.data.message
                                            : JSON.stringify(msg.data)}
                                    </td>
                                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#94a3b8', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                        {msg.receivedAt.toLocaleTimeString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <div ref={bottomRef} />
            </div>

            {/* ── Pipeline diagram ─────────────────────────────────────── */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                color: '#94a3b8',
                justifyContent: 'center',
                padding: '8px 0',
            }}>
                {['Browser POST /api/broadcasting/ping', '→', 'FastAPI broadcasts PingEvent', '→', 'Reverb WebSocket', '→', 'UI event log'].map((step, i) => (
                    <span
                        key={i}
                        style={step === '→' ? {} : {
                            padding: '3px 8px',
                            background: '#f1f5f9',
                            borderRadius: '4px',
                            fontWeight: 500,
                            color: '#64748b',
                        }}
                    >
                        {step}
                    </span>
                ))}
            </div>
        </div>
    )
}

Broadcasting.layout = (page: React.ReactNode) => <AppLayout>{page}</AppLayout>
