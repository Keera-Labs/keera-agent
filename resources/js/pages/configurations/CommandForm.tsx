import { useState } from 'react'
import { color } from '@/tokens'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle } from '@/components/ui/styles'

// Create-command form shown under the panel header. On submit it delegates the
// API call to the parent and only clears itself on success.
export function CommandForm({
    onCancel,
    onCreate,
}: {
    onCancel: () => void
    onCreate: (label: string, command: string) => Promise<string | null>
}) {
    const [label, setLabel] = useState('')
    const [cmd, setCmd] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        const err = await onCreate(label.trim(), cmd.trim())
        setLoading(false)
        if (err) setError(err)
    }

    return (
        <div style={{
            padding: '14px 20px', borderBottom: `1px solid ${color.border}`,
            background: color.bgSurface, flexShrink: 0,
        }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 180px' }}>
                        <span style={labelStyle}>Label</span>
                        <input
                            autoFocus
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            placeholder="Dev Server"
                            required
                            style={{ ...inputStyle, boxSizing: 'border-box', width: '100%' }}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        <span style={labelStyle}>Shell command</span>
                        <input
                            value={cmd}
                            onChange={e => setCmd(e.target.value)}
                            placeholder="npm run dev"
                            required
                            style={{
                                ...inputStyle, boxSizing: 'border-box', width: '100%',
                                fontFamily: '"JetBrains Mono", monospace',
                            }}
                        />
                    </div>
                </div>
                {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
                    <button type="submit" disabled={loading} style={submitBtnStyle}>
                        {loading ? 'Adding…' : 'Add command'}
                    </button>
                </div>
            </form>
        </div>
    )
}
