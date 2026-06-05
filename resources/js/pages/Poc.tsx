import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

function frameEncode(data: string | Uint8Array, type = 0x01): Uint8Array {
    const payload = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const frame = new Uint8Array(5 + payload.length)
    frame[0] = type
    new DataView(frame.buffer).setUint32(1, payload.length, false)
    frame.set(payload, 5)
    return frame
}

function frameDecode(data: ArrayBuffer): Uint8Array {
    const length = new DataView(data).getUint32(1, false)
    return new Uint8Array(data, 5, length)
}

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
                term.write(frameDecode(e.data))
            }
        }

        // Keyboard input → PTY
        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(frameEncode(data))
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
        ws.send(frameEncode(message + '\r'))
        setMessage('')
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

            <div style={{ display: 'flex', gap: 8 }}>
                <input
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder="Send a message to Claude…"
                    style={{
                        flex: 1, padding: '8px 12px', borderRadius: 6,
                        border: '1px solid #333', background: '#1a1a1a',
                        color: '#fff', fontSize: 14, fontFamily: 'monospace', outline: 'none',
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
