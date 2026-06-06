import { useState } from 'react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle } from '@/components/ui/styles'

export function SystemPromptModal({
    project,
    onClose,
    onUpdated,
}: {
    project: Project
    onClose: () => void
    onUpdated: (p: Project) => void
}) {
    const [prompt, setPrompt] = useState(project.system_prompt ?? '')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const res = await fetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ system_prompt: prompt.trim() || null }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            onUpdated(data as Project)
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '480px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <h2 style={{ margin: '0 0 4px', color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>
                            System Instructions —{' '}
                            <span style={{ fontFamily: '"JetBrains Mono", monospace', color: color.accent }}>{project.name}</span>
                        </h2>
                        <p style={{ margin: 0, color: color.textMuted, fontSize: '11px' }}>
                            Instructions passed to Claude when a new agent session starts. Leave blank to use no system prompt.
                        </p>
                    </div>
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>System prompt</span>
                        <textarea
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            placeholder="You are a helpful assistant specialized in..."
                            rows={8}
                            style={{
                                ...inputStyle,
                                resize: 'vertical',
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: '12px',
                                lineHeight: '1.5',
                            }}
                        />
                    </label>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                        <button type="submit" disabled={loading} style={submitBtnStyle}>
                            {loading ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
