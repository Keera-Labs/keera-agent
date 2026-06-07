import { useState, useEffect } from 'react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'

// Dark modal palette
const M = { bg: '#1c1f26', border: '#2a2f3a', inputBg: '#0d1117', inputText: '#e2e6ed', heading: '#f0f6fc', body: '#8b949e' }

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

    // Sync the textarea when the parent passes updated project data (e.g. after
    // the React Query cache refreshes stale data after the modal opens).
    useEffect(() => {
        setPrompt(project.system_prompt ?? '')
    }, [project.system_prompt])

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
                background: M.bg, border: `1px solid ${M.border}`, borderRadius: '8px',
                padding: '24px', width: '480px', display: 'flex', flexDirection: 'column', gap: '14px',
                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <h2 style={{ margin: '0 0 4px', color: M.heading, fontSize: '15px', fontWeight: 600 }}>
                            System Instructions —{' '}
                            <span style={{ fontFamily: '"JetBrains Mono", monospace', color: color.accent }}>{project.name}</span>
                        </h2>
                        <p style={{ margin: 0, color: M.body, fontSize: '11px' }}>
                            Instructions passed to Claude when a new agent session starts. Leave blank to use no system prompt.
                        </p>
                    </div>
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ color: M.body, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            System prompt
                        </span>
                        <textarea
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            placeholder="You are a helpful assistant specialized in..."
                            rows={8}
                            style={{
                                background: M.inputBg, border: `1px solid ${M.border}`, borderRadius: '6px',
                                color: M.inputText, fontSize: '12px', padding: '7px 10px',
                                outline: 'none', resize: 'vertical',
                                fontFamily: '"JetBrains Mono", monospace', lineHeight: '1.5',
                            }}
                        />
                    </label>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                            type="button" onClick={onClose}
                            style={{ background: 'transparent', border: `1px solid ${M.border}`, borderRadius: '6px', color: M.body, fontSize: '12px', padding: '6px 14px', cursor: 'pointer' }}
                        >Cancel</button>
                        <button
                            type="submit" disabled={loading}
                            style={{ background: color.accentEmphasis, border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, padding: '6px 14px', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}
                        >
                            {loading ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
