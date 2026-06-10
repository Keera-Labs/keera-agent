import { useState } from 'react'
import { useBroadcastChannel } from '@/hooks/useBroadcastChannel'

type Mode = 'poc' | 'ai'

interface AiMessage {
    prompt: string
    response: string
}

export function BroadcastPocPanel() {
    const [mode, setMode] = useState<Mode>('poc')
    const [input, setInput] = useState('')
    const [firing, setFiring] = useState(false)
    const [aiLoading, setAiLoading] = useState(false)
    const [aiMessages, setAiMessages] = useState<AiMessage[]>([])

    const pocMessages = useBroadcastChannel('test-channel')
    useBroadcastChannel('ai-responses') // subscribe so AI broadcasts arrive even if not displayed

    async function handlePocFire() {
        if (!input.trim()) return
        setFiring(true)
        try {
            await fetch('/api/broadcast/fire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: input.trim() }),
            })
            setInput('')
        } finally {
            setFiring(false)
        }
    }

    async function handleAiChat() {
        if (!input.trim()) return
        const userMessage = input.trim()
        setInput('')
        setAiLoading(true)
        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage }),
            })
            const data = await res.json()
            if (data.response) {
                setAiMessages(prev => [...prev, { prompt: userMessage, response: data.response }])
            }
        } finally {
            setAiLoading(false)
        }
    }

    function handleSubmit() {
        if (mode === 'poc') {
            handlePocFire()
        } else {
            handleAiChat()
        }
    }

    const isLoading = mode === 'poc' ? firing : aiLoading

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '16px',
                right: '16px',
                width: '360px',
                maxHeight: '480px',
                background: '#1e1e2e',
                border: '1px solid #3b3b5c',
                borderRadius: '10px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                fontFamily: 'monospace',
                fontSize: '12px',
            }}
        >
            {/* Header with mode toggle */}
            <div
                style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #3b3b5c',
                    background: '#16161f',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                }}
            >
                <span style={{ color: '#a0a0c0', fontWeight: 700, letterSpacing: '0.05em', marginRight: 'auto' }}>
                    📡 Broadcast
                </span>
                <button
                    onClick={() => setMode('poc')}
                    style={{
                        background: mode === 'poc' ? '#7c6af7' : '#2a2a40',
                        color: mode === 'poc' ? '#fff' : '#a0a0c0',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '3px 10px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: '11px',
                    }}
                >
                    POC
                </button>
                <button
                    onClick={() => setMode('ai')}
                    style={{
                        background: mode === 'ai' ? '#38bdf8' : '#2a2a40',
                        color: mode === 'ai' ? '#0f172a' : '#a0a0c0',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '3px 10px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: '11px',
                    }}
                >
                    AI Chat
                </button>
            </div>

            {/* Channel label */}
            <div
                style={{
                    padding: '4px 12px',
                    background: '#16161f',
                    borderBottom: '1px solid #3b3b5c',
                    color: '#555580',
                    fontSize: '10px',
                }}
            >
                {mode === 'poc' ? 'channel: test-channel' : 'channel: ai-responses'}
            </div>

            {/* Message list */}
            <div
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    minHeight: '80px',
                    maxHeight: '300px',
                }}
            >
                {mode === 'poc' ? (
                    pocMessages.length === 0 ? (
                        <span style={{ color: '#555580', fontStyle: 'italic' }}>
                            Waiting for messages…
                        </span>
                    ) : (
                        [...pocMessages].reverse().map((msg, i) => (
                            <div
                                key={i}
                                style={{
                                    padding: '4px 8px',
                                    background: '#2a2a40',
                                    borderRadius: '4px',
                                    color: '#c8c8e8',
                                    wordBreak: 'break-word',
                                }}
                            >
                                <span style={{ color: '#7c6af7', marginRight: 4 }}>
                                    {msg.event}
                                </span>
                                {typeof msg.data?.message === 'string'
                                    ? msg.data.message
                                    : JSON.stringify(msg.data)}
                            </div>
                        ))
                    )
                ) : aiMessages.length === 0 && !aiLoading ? (
                    <span style={{ color: '#555580', fontStyle: 'italic' }}>
                        Ask Keera anything…
                    </span>
                ) : (
                    <>
                        {aiMessages.map((msg, i) => (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {/* User prompt */}
                                <div
                                    style={{
                                        padding: '4px 8px',
                                        background: '#2a2a40',
                                        borderRadius: '4px',
                                        color: '#c8c8e8',
                                        wordBreak: 'break-word',
                                        alignSelf: 'flex-end',
                                        maxWidth: '90%',
                                    }}
                                >
                                    <span style={{ color: '#7c6af7', marginRight: 4 }}>you:</span>
                                    {msg.prompt}
                                </div>
                                {/* AI response */}
                                <div
                                    style={{
                                        padding: '4px 8px',
                                        background: '#0f2030',
                                        borderRadius: '4px',
                                        color: '#c8c8e8',
                                        wordBreak: 'break-word',
                                        alignSelf: 'flex-start',
                                        maxWidth: '90%',
                                        borderLeft: '2px solid #38bdf8',
                                    }}
                                >
                                    <span style={{ color: '#38bdf8', marginRight: 4 }}>keera:</span>
                                    {msg.response}
                                </div>
                            </div>
                        ))}
                        {aiLoading && (
                            <span style={{ color: '#555580', fontStyle: 'italic' }}>Thinking…</span>
                        )}
                    </>
                )}
            </div>

            {/* Input + Submit button */}
            <div
                style={{
                    display: 'flex',
                    gap: '6px',
                    padding: '8px 12px',
                    borderTop: '1px solid #3b3b5c',
                    background: '#16161f',
                }}
            >
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    placeholder={mode === 'poc' ? 'Type a message…' : 'Ask Keera…'}
                    style={{
                        flex: 1,
                        background: '#2a2a40',
                        border: '1px solid #3b3b5c',
                        borderRadius: '4px',
                        color: '#e0e0ff',
                        padding: '4px 8px',
                        fontSize: '12px',
                        outline: 'none',
                    }}
                />
                <button
                    onClick={handleSubmit}
                    disabled={isLoading || !input.trim()}
                    style={{
                        background: isLoading
                            ? '#4a4a70'
                            : mode === 'ai'
                                ? '#38bdf8'
                                : '#7c6af7',
                        color: mode === 'ai' && !isLoading ? '#0f172a' : '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 12px',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        fontWeight: 700,
                        fontSize: '12px',
                    }}
                >
                    {isLoading ? '…' : mode === 'poc' ? 'Fire' : 'Send'}
                </button>
            </div>
        </div>
    )
}
