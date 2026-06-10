import { useEffect, useRef, useState } from 'react'
import { useBroadcastChannel } from '@/hooks/useBroadcastChannel'

interface ChatMessage {
    role: 'user' | 'ai'
    text: string
    error?: boolean
    id: number
}

let _id = 0
function nextId() { return ++_id }

export function BroadcastPocPanel() {
    const [input, setInput] = useState('')
    const [waiting, setWaiting] = useState(false)
    const [chat, setChat] = useState<ChatMessage[]>([])
    const scrollRef = useRef<HTMLDivElement>(null)
    const broadcastMessages = useBroadcastChannel('test-channel')
    const prevLenRef = useRef(0)

    // React to new broadcast messages
    useEffect(() => {
        const newMessages = broadcastMessages.slice(prevLenRef.current)
        prevLenRef.current = broadcastMessages.length

        for (const msg of newMessages) {
            if (msg.event === 'AIChatResponseEvent') {
                const response = typeof msg.data?.response === 'string' ? msg.data.response : JSON.stringify(msg.data)
                const isError = msg.data?.error === true
                setChat(prev => [...prev, { role: 'ai', text: response, error: isError, id: nextId() }])
                setWaiting(false)
            }
            // TestBroadcastEvent is the echo — we already added the user message locally, skip it
        }
    }, [broadcastMessages])

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [chat, waiting])

    async function handleSend() {
        const text = input.trim()
        if (!text || waiting) return

        setChat(prev => [...prev, { role: 'user', text, id: nextId() }])
        setInput('')
        setWaiting(true)

        await fetch('/api/broadcast/fire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text }),
        })
    }

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '16px',
                right: '16px',
                width: '360px',
                maxHeight: '520px',
                background: '#1e1e2e',
                border: '1px solid #3b3b5c',
                borderRadius: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '13px',
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid #3b3b5c',
                    color: '#a0a0c0',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    background: '#16161f',
                    fontSize: '12px',
                }}
            >
                🤖 AI Chat · claude -p
            </div>

            {/* Message list */}
            <div
                ref={scrollRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    minHeight: '100px',
                    maxHeight: '360px',
                }}
            >
                {chat.length === 0 && !waiting && (
                    <span style={{ color: '#555580', fontStyle: 'italic', fontSize: '12px' }}>
                        Send a message to chat with Claude…
                    </span>
                )}

                {chat.map(msg => (
                    <div
                        key={msg.id}
                        style={{
                            display: 'flex',
                            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        }}
                    >
                        <div
                            style={{
                                maxWidth: '80%',
                                padding: '7px 11px',
                                borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                                background: msg.role === 'user'
                                    ? '#6d28d9'
                                    : msg.error
                                    ? '#5c1a1a'
                                    : '#27272a',
                                color: msg.role === 'user'
                                    ? '#ede9fe'
                                    : msg.error
                                    ? '#fca5a5'
                                    : '#d4d4d8',
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-wrap',
                                lineHeight: '1.45',
                            }}
                        >
                            {msg.text}
                        </div>
                    </div>
                ))}

                {/* Thinking spinner */}
                {waiting && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div
                            style={{
                                padding: '7px 14px',
                                borderRadius: '12px 12px 12px 2px',
                                background: '#27272a',
                                color: '#71717a',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '12px',
                            }}
                        >
                            <span
                                style={{
                                    display: 'inline-block',
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: '#a78bfa',
                                    animation: 'pulse 1.2s ease-in-out infinite',
                                }}
                            />
                            Thinking…
                            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
                        </div>
                    </div>
                )}
            </div>

            {/* Input row */}
            <div
                style={{
                    display: 'flex',
                    gap: '6px',
                    padding: '10px 12px',
                    borderTop: '1px solid #3b3b5c',
                    background: '#16161f',
                }}
            >
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    placeholder="Ask Claude…"
                    disabled={waiting}
                    style={{
                        flex: 1,
                        background: '#2a2a40',
                        border: '1px solid #3b3b5c',
                        borderRadius: '6px',
                        color: '#e0e0ff',
                        padding: '6px 10px',
                        fontSize: '13px',
                        outline: 'none',
                        opacity: waiting ? 0.6 : 1,
                    }}
                />
                <button
                    onClick={handleSend}
                    disabled={waiting || !input.trim()}
                    style={{
                        background: waiting || !input.trim() ? '#3b3b5c' : '#6d28d9',
                        color: waiting || !input.trim() ? '#71717a' : '#ede9fe',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        cursor: waiting || !input.trim() ? 'not-allowed' : 'pointer',
                        fontWeight: 700,
                        fontSize: '13px',
                        transition: 'background 0.15s',
                    }}
                >
                    Send
                </button>
            </div>
        </div>
    )
}
