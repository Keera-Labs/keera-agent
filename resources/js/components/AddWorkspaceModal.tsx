import { useState } from 'react'
import { color } from '@/tokens'
import { useWorkspace } from '@/layouts/hooks/workspace'

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { color: color.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle: React.CSSProperties = {
    background: color.bgBase, border: `1px solid ${color.borderMuted}`, borderRadius: '6px',
    color: color.textPrimary, fontSize: '13px', padding: '6px 10px',
    fontFamily: '"JetBrains Mono", monospace', outline: 'none',
}
const cancelBtnStyle: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${color.borderMuted}`, borderRadius: '6px',
    color: color.textMuted, fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
}
const submitBtnStyle: React.CSSProperties = {
    background: color.successEmphasis, border: `1px solid ${color.successBorder}`, borderRadius: '6px',
    color: '#fff', fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
}

// ─── Add Workspace Modal ──────────────────────────────────────────────────────

export default function AddWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const { create, creating } = useWorkspace()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [error, setError] = useState('')

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        if (!name.trim()) { setError('Name is required'); return }
        try {
            await create({ name: name.trim(), description: description.trim() || undefined })
            onCreated()
            onClose()
        } catch {
            setError('Network error')
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgSurface, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '340px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>New Workspace</h2>
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Name</span>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="my-workspace" required style={inputStyle} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Description</span>
                        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" style={inputStyle} />
                    </label>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                        <button type="submit" disabled={creating} style={submitBtnStyle}>
                            {creating ? 'Creating…' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
