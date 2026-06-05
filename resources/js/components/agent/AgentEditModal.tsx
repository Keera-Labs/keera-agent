import { useEffect, useState } from 'react'
import { color } from '@/tokens'
import { type ProjectAgent, type AgentFlags } from '@/layouts/hooks/agents'

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_TYPE_LABELS: Record<string, string> = {
    pm: 'PM',
    software_engineer: 'Software Engineer',
    qa: 'QA',
    custom: 'Custom',
}

const AGENT_TYPE_COLORS: Record<string, string> = {
    pm: '#58a6ff',
    software_engineer: '#3fb950',
    qa: '#ffa657',
    custom: '#bc8cff',
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
    color: color.textMuted, fontSize: '11px',
    textTransform: 'uppercase', letterSpacing: '0.05em',
}
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
const flagRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 10px', borderRadius: '6px',
    background: color.bgCanvas, border: `1px solid ${color.borderMuted}`, cursor: 'pointer',
}
const toggleStyle = (on: boolean): React.CSSProperties => ({
    width: '32px', height: '18px', borderRadius: '9px',
    background: on ? color.accent : color.borderMuted,
    border: 'none', cursor: 'pointer', position: 'relative',
    flexShrink: 0, transition: 'background 0.15s',
})

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentEditModal({
    agent,
    onClose,
    onSaved,
}: {
    agent: ProjectAgent
    onClose: () => void
    onSaved: (updated: ProjectAgent) => void
}) {
    const [name, setName] = useState(agent.name)
    const [model, setModel] = useState(agent.model ?? 'claude-sonnet-4-6')
    const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt ?? '')
    const [flags, setFlags] = useState<AgentFlags>(agent.flags ?? {})
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    function setFlag(key: keyof AgentFlags, value: boolean | number | null) {
        setFlags(prev => ({ ...prev, [key]: value }))
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const trimmedName = name.trim()
        if (!trimmedName) { setError('Name is required'); return }
        setError('')
        setLoading(true)
        try {
            const res = await fetch(`/api/agents/${agent.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: trimmedName,
                    model,
                    system_prompt: systemPrompt.trim() || null,
                    flags,
                }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            onSaved(data as ProjectAgent)
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    // Close on Escape
    useEffect(() => {
        function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    const agentBg = AGENT_TYPE_COLORS[agent.agent_type] ?? color.accent

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: color.overlay,
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
            }}
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div style={{
                background: color.bgSurface, border: `1px solid ${color.borderMuted}`, borderRadius: '10px',
                width: '480px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
                display: 'flex', flexDirection: 'column',
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '16px 20px', borderBottom: `1px solid ${color.border}`, flexShrink: 0,
                }}>
                    <div style={{
                        width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
                        background: agentBg, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#fff',
                    }}>
                        {agent.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ color: color.textPrimary, fontSize: '14px', fontWeight: 600 }}>Edit Agent</div>
                        <div style={{ color: color.textMuted, fontSize: '11px', marginTop: '1px' }}>
                            {AGENT_TYPE_LABELS[agent.agent_type] ?? agent.agent_type}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: 'transparent', border: 'none', color: color.textFaint, cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 4px' }}
                    >×</button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

                    {/* Name */}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Name</span>
                        <input
                            autoFocus
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Agent name"
                            required
                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }}
                        />
                    </label>

                    {/* Model */}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Model</span>
                        <select
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const }}
                        >
                            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                            <option value="claude-opus-4-6">Claude Opus 4.6</option>
                            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                        </select>
                    </label>

                    {/* System Prompt */}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>System Prompt</span>
                        <textarea
                            value={systemPrompt}
                            onChange={e => setSystemPrompt(e.target.value)}
                            placeholder="Instructions for this agent… (leave blank to use none)"
                            rows={8}
                            style={{
                                ...inputStyle,
                                width: '100%', boxSizing: 'border-box' as const,
                                resize: 'vertical' as const, lineHeight: 1.5,
                                fontFamily: '"JetBrains Mono", monospace', fontSize: '12px',
                            }}
                        />
                    </label>

                    {/* Launch Flags */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={labelStyle}>Launch Options</span>

                        {/* Skip Permissions */}
                        <div
                            style={flagRowStyle}
                            onClick={() => setFlag('dangerously_skip_permissions', !flags.dangerously_skip_permissions)}
                        >
                            <div>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Skip Permissions</div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>--dangerously-skip-permissions — no prompts</div>
                            </div>
                            <button
                                type="button"
                                style={toggleStyle(!!flags.dangerously_skip_permissions)}
                                onClick={e => e.stopPropagation()}
                                title="Toggle --dangerously-skip-permissions"
                            >
                                <span style={{
                                    position: 'absolute', top: '3px',
                                    left: flags.dangerously_skip_permissions ? '17px' : '3px',
                                    width: '12px', height: '12px', borderRadius: '50%',
                                    background: '#fff', transition: 'left 0.15s',
                                }} />
                            </button>
                        </div>

                        {/* Plan Mode */}
                        <div
                            style={flagRowStyle}
                            onClick={() => setFlag('plan_mode', !flags.plan_mode)}
                        >
                            <div>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Plan Mode</div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>Read-only — analyse and plan, never edit files</div>
                            </div>
                            <button
                                type="button"
                                style={toggleStyle(!!flags.plan_mode)}
                                onClick={e => e.stopPropagation()}
                                title="Toggle plan mode"
                            >
                                <span style={{
                                    position: 'absolute', top: '3px',
                                    left: flags.plan_mode ? '17px' : '3px',
                                    width: '12px', height: '12px', borderRadius: '50%',
                                    background: '#fff', transition: 'left 0.15s',
                                }} />
                            </button>
                        </div>
                    </div>

                    {/* Footer */}
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
                        <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                        <button type="submit" disabled={loading} style={{ ...submitBtnStyle, opacity: loading ? 0.7 : 1 }}>
                            {loading ? 'Saving…' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
