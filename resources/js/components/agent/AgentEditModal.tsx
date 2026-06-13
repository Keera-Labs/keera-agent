import { useEffect, useState } from 'react'
import { color } from '@/tokens'
import { type ProjectAgent, type AgentFlags, normalizeAgent } from '@/layouts/hooks/agents'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from '@/types/agent'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'

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
    const [agentType, setAgentType] = useState(agent.agent_type)
    const [description, setDescription] = useState(agent.description ?? '')
    const [model, setModel] = useState(agent.model ?? 'claude-opus-4-8')
    const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt ?? '')
    const [flags, setFlags] = useState<AgentFlags>(agent.flags ?? {})
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    // Sync fields when the agent prop changes (e.g. modal re-opened for a different agent)
    useEffect(() => {
        setName(agent.name)
        setAgentType(agent.agent_type)
        setDescription(agent.description ?? '')
        setModel(agent.model ?? 'claude-opus-4-8')
        setSystemPrompt(agent.system_prompt ?? '')
        setFlags(agent.flags ?? {})
        setError('')
    }, [agent.id])

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
                    agent_type: agentType,
                    description: description.trim() || null,
                    model,
                    system_prompt: systemPrompt.trim() || null,
                    flags,
                }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            onSaved(normalizeAgent(data.data))
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

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: color.overlay,
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
            }}
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div style={{
                background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '600px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
                display: 'flex', flexDirection: 'column',
            }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>Edit Agent</h2>

                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

                    {/* Type selector */}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={labelStyle}>Type</span>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {Object.entries(AGENT_TYPE_LABELS).map(([type, label]) => {
                                const active = agentType === type
                                return (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => setAgentType(type)}
                                        style={{
                                            padding: '5px 12px',
                                            borderRadius: '6px',
                                            border: `1px solid ${active ? AGENT_TYPE_COLORS[type] ?? color.accent : color.borderMuted}`,
                                            background: active ? `${AGENT_TYPE_COLORS[type] ?? color.accent}18` : 'transparent',
                                            color: active ? (AGENT_TYPE_COLORS[type] ?? color.accent) : color.textMuted,
                                            fontSize: '12px', fontWeight: active ? 600 : 400,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {label}
                                    </button>
                                )
                            })}
                        </div>
                    </label>

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

                    {/* Description */}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Description</span>
                        <input
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Short description"
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
                            <option value="claude-opus-4-8">Claude Opus 4.8</option>
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
                            rows={6}
                            style={{
                                ...inputStyle,
                                width: '100%', boxSizing: 'border-box' as const,
                                resize: 'vertical' as const, lineHeight: 1.5,
                            }}
                        />
                    </label>

                    {/* Launch Options */}
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

                        {/* Verbose */}
                        <div
                            style={flagRowStyle}
                            onClick={() => setFlag('verbose', !flags.verbose)}
                        >
                            <div>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Verbose</div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>--verbose — detailed claude output</div>
                            </div>
                            <button
                                type="button"
                                style={toggleStyle(!!flags.verbose)}
                                onClick={e => e.stopPropagation()}
                                title="Toggle --verbose"
                            >
                                <span style={{
                                    position: 'absolute', top: '3px',
                                    left: flags.verbose ? '17px' : '3px',
                                    width: '12px', height: '12px', borderRadius: '50%',
                                    background: '#fff', transition: 'left 0.15s',
                                }} />
                            </button>
                        </div>

                        {/* Max Turns */}
                        <div style={{ ...flagRowStyle, gap: '12px' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Max Turns</div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>--max-turns N — limit conversation turns</div>
                            </div>
                            <input
                                type="number"
                                min={1}
                                max={500}
                                placeholder="∞"
                                value={flags.max_turns ?? ''}
                                onChange={e => setFlag('max_turns', e.target.value ? parseInt(e.target.value, 10) : null)}
                                style={{ ...inputStyle, width: '72px', textAlign: 'center', padding: '4px 8px' }}
                            />
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
