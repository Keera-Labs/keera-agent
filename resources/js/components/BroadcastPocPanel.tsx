import { useState } from 'react'
import { useBroadcastChannel } from '@/hooks/useBroadcastChannel'

export function BroadcastPocPanel() {
    const [input, setInput] = useState('')
    const [firing, setFiring] = useState(false)
    const messages = useBroadcastChannel('test-channel')

    async function handleFire() {
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

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '16px',
                right: '16px',
                width: '320px',
                maxHeight: '400px',
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
            {/* Header */}
            <div
                style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #3b3b5c',
                    color: '#a0a0c0',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    background: '#16161f',
                }}
            >
                📡 Broadcast POC · test-channel
            </div>

            {/* Message list */}
            <div
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    minHeight: '80px',
                    maxHeight: '260px',
                }}
            >
                {messages.length === 0 ? (
                    <span style={{ color: '#555580', fontStyle: 'italic' }}>
                        Waiting for messages…
                    </span>
                ) : (
                    [...messages].reverse().map((msg, i) => (
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
                )}
            </div>

            {/* Input + Fire button */}
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
                    onKeyDown={e => e.key === 'Enter' && handleFire()}
                    placeholder="Type a message…"
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
                    onClick={handleFire}
                    disabled={firing || !input.trim()}
                    style={{
                        background: firing ? '#4a4a70' : '#7c6af7',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 12px',
                        cursor: firing ? 'not-allowed' : 'pointer',
                        fontWeight: 700,
                        fontSize: '12px',
                    }}
                >
                    {firing ? '…' : 'Fire'}
                </button>
            </div>
        </div>
    )
}
