import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'


export default function Poc() {
    const termRef = useRef<HTMLDivElement>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const [message, setMessage] = useState('')
    const [connected, setConnected] = useState(false)

    useEffect(() => {
        const term = new Terminal({ cursorBlink: true, fontSize: 14 })
        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)

        if (termRef.current) {
            term.open(termRef.current)
            fitAddon.fit()
        }

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${proto}//${window.location.host}/poc/ws`)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onopen = () => setConnected(true)
        ws.onclose = () => setConnected(false)

        ws.onmessage = (e) => {
            if (e.data instanceof ArrayBuffer) {
                term.write(new Uint8Array(e.data as ArrayBuffer))
            }
        }

        // Keyboard input → PTY
        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data)
            }
        })

        const observer = new ResizeObserver(() => fitAddon.fit())
        if (termRef.current) observer.observe(termRef.current)

        return () => {
            observer.disconnect()
            ws.close()
            term.dispose()
        }
    }, [])

    function sendMessage() {
        const ws = wsRef.current
        if (!message.trim() || !ws || ws.readyState !== WebSocket.OPEN) return
        ws.send(new TextEncoder().encode(message.replace(/\n/g, '\r')))
        setMessage('')
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d0d', padding: 16, gap: 12, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ color: '#fff', margin: 0, fontSize: 16, fontFamily: 'monospace' }}>POC — Claude PTY</h1>
                <span style={{
                    fontSize: 12, padding: '2px 8px', borderRadius: 99,
                    background: connected ? '#1a3a1a' : '#3a1a1a',
                    color: connected ? '#4ade80' : '#f87171',
                }}>
                    {connected ? 'connected' : 'disconnected'}
                </span>
            </div>

            <div ref={termRef} style={{ flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid #2a2a2a' }} />

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Send a message to Claude… (Shift+Enter for newline)"
                    rows={3}
                    style={{
                        flex: 1, padding: '8px 12px', borderRadius: 6,
                        border: '1px solid #333', background: '#1a1a1a',
                        color: '#fff', fontSize: 14, fontFamily: 'monospace', outline: 'none',
                        resize: 'none',
                    }}
                />
                <button
                    onClick={sendMessage}
                    style={{
                        padding: '8px 18px', borderRadius: 6, border: 'none',
                        background: '#6c47ff', color: '#fff', cursor: 'pointer',
                        fontSize: 14, fontWeight: 600,
                    }}
                >
                    Send
                </button>
            </div>
        </div>
    )
}
