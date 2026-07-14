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
        <div className="flex flex-col h-full max-w-[720px] mx-auto py-8 px-6 gap-6 box-border">
            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="flex items-center gap-3">
                <h1 className="m-0 text-[20px] font-bold text-[#111]">
                    Broadcasting POC
                </h1>

                {/* Connection status badge */}
                <span
                    className="inline-flex items-center gap-1.5 py-[3px] px-2.5 rounded-full text-[12px] font-semibold"
                    style={{ background: sc.bg, color: sc.text }}
                >
                    <span
                        className="w-[7px] h-[7px] rounded-full"
                        style={{
                            background: sc.dot,
                            boxShadow: status === 'connected' ? `0 0 0 2px ${sc.dot}40` : 'none',
                        }}
                    />
                    {status}
                </span>

                <span className="text-[12px] text-[#94a3b8] ml-auto">
                    channel: <code className="bg-[#f1f5f9] py-px px-[5px] rounded-sm">{CHANNEL_NAME}</code>
                </span>
            </div>

            {/* ── Description ─────────────────────────────────────────── */}
            <p className="m-0 text-[13px] text-[#64748b] leading-[1.6]">
                This page proves the full broadcast pipeline:{' '}
                <strong>HTTP POST → server broadcasts event → Reverb WebSocket → UI updates live.</strong>{' '}
                Type a message and click <strong>Ping</strong>; the event should appear in the log below within
                milliseconds.
            </p>

            {/* ── Input + button ──────────────────────────────────────── */}
            <div className="flex gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder='Message (default: "ping")'
                    disabled={sending}
                    className="flex-1 py-2 px-3 border border-[#e2e8f0] rounded text-[14px] text-[#1e293b] bg-[#fff] outline-none"
                />
                <button
                    onClick={handlePing}
                    disabled={sending || status !== 'connected'}
                    className={`py-2 px-5 rounded border-none text-white font-semibold text-[14px] transition-colors duration-150 ${sending || status !== 'connected' ? 'bg-[#94a3b8] cursor-not-allowed' : 'bg-[#6c47ff] cursor-pointer'}`}
                >
                    {sending ? 'Sending…' : 'Ping'}
                </button>
            </div>

            {/* ── Error ───────────────────────────────────────────────── */}
            {error && (
                <div className="py-2 px-3 bg-[#fee2e2] border border-[#fca5a5] rounded text-[#b91c1c] text-[13px]">
                    ⚠ {error}
                </div>
            )}

            {/* ── Event log ───────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto border border-[#e2e8f0] rounded-md bg-[#f8fafc] min-h-[200px]">
                {messages.length === 0 ? (
                    <div className="p-8 text-center text-[#94a3b8] text-[13px]">
                        {status === 'connected'
                            ? 'No events yet — click Ping to send one.'
                            : 'Waiting for WebSocket connection…'}
                    </div>
                ) : (
                    <table className="w-full border-collapse text-[13px]">
                        <thead>
                            <tr className="bg-[#f1f5f9] border-b border-b-[#e2e8f0]">
                                <th className="py-2 px-3 text-left text-[#64748b] font-semibold w-10">#</th>
                                <th className="py-2 px-3 text-left text-[#64748b] font-semibold">Event</th>
                                <th className="py-2 px-3 text-left text-[#64748b] font-semibold">Data</th>
                                <th className="py-2 px-3 text-right text-[#64748b] font-semibold whitespace-nowrap">Received at</th>
                            </tr>
                        </thead>
                        <tbody>
                            {messages.map(msg => (
                                <tr key={msg.id} className="border-b border-b-[#e2e8f0] bg-[#fff]">
                                    <td className="py-2 px-3 text-[#94a3b8]">{msg.id}</td>
                                    <td className="py-2 px-3">
                                        <code className="bg-[#ede9fe] text-[#6c47ff] py-px px-1.5 rounded-sm font-semibold">
                                            {msg.event}
                                        </code>
                                    </td>
                                    <td className="py-2 px-3 text-[#374151] [word-break:break-word]">
                                        {typeof msg.data?.message === 'string'
                                            ? msg.data.message
                                            : JSON.stringify(msg.data)}
                                    </td>
                                    <td className="py-2 px-3 text-right text-[#94a3b8] [font-variant-numeric:tabular-nums] whitespace-nowrap">
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
            <div className="flex items-center gap-2 text-[11px] text-[#94a3b8] justify-center py-2">
                {['Browser POST /api/broadcasting/ping', '→', 'FastAPI broadcasts PingEvent', '→', 'Reverb WebSocket', '→', 'UI event log'].map((step, i) => (
                    <span
                        key={i}
                        className={step === '→' ? '' : 'py-[3px] px-2 bg-[#f1f5f9] rounded-sm font-medium text-[#64748b]'}
                    >
                        {step}
                    </span>
                ))}
            </div>
        </div>
    )
}

Broadcasting.layout = [AppLayout]
