import { useState, useEffect, useRef } from 'react'
import { color } from '@/tokens'
import type { ProjectAgent, AgentFlags } from '@/hooks/agents'
import { normalizeAgent } from '@/hooks/agents'
import type { AgentTemplate } from '@/types/agent'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from '@/types/agent'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'

/**
 * Find the "plain" builtin template for an agent type — prefers one without
 * special flags (full-auto / plan-mode) so we get the natural defaults.
 */
function findBuiltinForType(templates: AgentTemplate[], agentType: string): AgentTemplate | undefined {
    return (
        templates.find(t => t.is_builtin && t.agent_type === agentType && !t.flags?.dangerously_skip_permissions && !t.plan_mode)
        ?? templates.find(t => t.is_builtin && t.agent_type === agentType)
    )
}

export function AgentAddModal({ projectId, onClose, onCreated, templates, agentCount, maxAgents }: {
    projectId: number
    onClose: () => void
    onCreated: (a: ProjectAgent) => void
    templates: AgentTemplate[]
    agentCount?: number
    maxAgents?: number
}) {
    const [name, setName] = useState('')
    const [agentType, setAgentType] = useState<string>('software_engineer')
    const [description, setDescription] = useState(() => findBuiltinForType(templates, 'software_engineer')?.description ?? '')
    const [systemPrompt, setSystemPrompt] = useState(() => findBuiltinForType(templates, 'software_engineer')?.system_prompt ?? '')
    const [model, setModel] = useState('claude-opus-4-8')
    const [flags, setFlags] = useState<AgentFlags>({})
    const [planMode, setPlanMode] = useState(false)
    const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const isAtLimit = agentCount !== undefined && maxAgents !== undefined && agentCount >= maxAgents

    // If templates weren't in cache at mount time, populate defaults once they arrive
    const templateInitialized = useRef(templates.length > 0)
    useEffect(() => {
        if (!templateInitialized.current && templates.length > 0) {
            templateInitialized.current = true
            const tpl = findBuiltinForType(templates, agentType)
            if (tpl) {
                setDescription(prev => prev || (tpl.description ?? ''))
                setSystemPrompt(prev => prev || (tpl.system_prompt ?? ''))
            }
        }
    }, [templates]) // eslint-disable-line react-hooks/exhaustive-deps

    function applyTemplate(tpl: AgentTemplate | null) {
        if (!tpl) {
            setSelectedTemplateId(null)
            setAgentType('software_engineer')
            setDescription('')
            setSystemPrompt('')
            setModel('claude-opus-4-8')
            setFlags({})
            setPlanMode(false)
            return
        }
        setSelectedTemplateId(tpl.id)
        setAgentType(tpl.agent_type)
        setModel(tpl.model)
        setFlags(tpl.flags ?? {})
        setPlanMode(!!tpl.plan_mode)
        setDescription(tpl.description ?? '')
        setSystemPrompt(tpl.system_prompt ?? '')
    }

    function setFlag(key: keyof AgentFlags, value: boolean | number | null) {
        setFlags(prev => ({ ...prev, [key]: value }))
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const res = await fetch(`/api/projects/${projectId}/agents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, agent_type: agentType, description, system_prompt: systemPrompt, model, flags, plan_mode: planMode }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            onCreated(normalizeAgent(data.data))
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    const templateCardStyle = (active: boolean): React.CSSProperties => ({
        padding: '8px 10px',
        borderRadius: '6px',
        border: `1px solid ${active ? color.accent : color.borderMuted}`,
        background: active ? `${color.accent}18` : color.bgCanvas,
        cursor: 'pointer',
        flexShrink: 0,
        minWidth: '100px',
        maxWidth: '140px',
        textAlign: 'left',
    })

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '520px', display: 'flex', flexDirection: 'column', gap: '14px',
                maxHeight: '90vh', overflowY: 'auto',
            }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>Add Agent</h2>
                    {isAtLimit && (
                        <div style={{ color: color.danger, fontSize: '12px', padding: '8px 12px', background: `${color.danger}14`, borderRadius: '6px', border: `1px solid ${color.danger}40` }}>
                            Agent limit reached ({agentCount}/{maxAgents}). Delete an existing agent before adding a new one.
                        </div>
                    )}
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

                    {/* Template selector */}
                    {templates.length > 0 && (
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <span style={labelStyle}>Template</span>
                            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                                <button
                                    key="blank"
                                    type="button"
                                    onClick={() => applyTemplate(null)}
                                    style={templateCardStyle(selectedTemplateId === null && !systemPrompt)}
                                >
                                    <div style={{ fontSize: '11px', fontWeight: 600, color: color.textSecondary }}>Blank</div>
                                    <div style={{ fontSize: '10px', color: color.textFaint, marginTop: '2px' }}>Start from scratch</div>
                                </button>
                                {templates.map(tpl => {
                                    const active = selectedTemplateId === tpl.id
                                    const typeColor = AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textMuted
                                    return (
                                        <button
                                            key={tpl.id}
                                            type="button"
                                            onClick={() => applyTemplate(tpl)}
                                            style={templateCardStyle(active)}
                                        >
                                            <div style={{ fontSize: '11px', fontWeight: 600, color: active ? color.accent : color.textSecondary }}>
                                                {tpl.name}
                                            </div>
                                            <div style={{ fontSize: '10px', color: typeColor, marginTop: '2px' }}>
                                                {AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type}
                                            </div>
                                            {(tpl.flags?.dangerously_skip_permissions || tpl.plan_mode) && (
                                                <div style={{ display: 'flex', gap: '3px', marginTop: '4px', flexWrap: 'wrap' }}>
                                                    {tpl.flags?.dangerously_skip_permissions && (
                                                        <span style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: '#ff6b3518', color: '#ff6b35', fontWeight: 600 }}>FULL AUTO</span>
                                                    )}
                                                    {tpl.plan_mode && (
                                                        <span style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: `${color.accent}18`, color: color.accent, fontWeight: 600 }}>PLAN ONLY</span>
                                                    )}
                                                </div>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </label>
                    )}

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Name</span>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder={agentType === 'pm' ? 'e.g. Alice' : agentType === 'qa' ? 'e.g. QA Bot' : 'e.g. Dev Agent'}
                            required
                            style={inputStyle}
                        />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Description</span>
                        <input
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Short description"
                            style={inputStyle}
                        />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Model</span>
                        <select value={model} onChange={e => setModel(e.target.value)} style={inputStyle}>
                            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                            <option value="claude-opus-4-8">Claude Opus 4.8</option>
                            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                        </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>System Prompt</span>
                        <textarea
                            value={systemPrompt}
                            onChange={e => setSystemPrompt(e.target.value)}
                            placeholder="Instructions for this agent…"
                            rows={6}
                            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                        />
                    </label>

                    {/* Launch Options */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={labelStyle}>Launch Options</span>

                        <div style={flagRowStyle}>
                            <div>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Skip Permissions</div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>--dangerously-skip-permissions — no prompts</div>
                            </div>
                            <button
                                type="button"
                                style={toggleStyle(!!flags.dangerously_skip_permissions)}
                                onClick={() => setFlag('dangerously_skip_permissions', !flags.dangerously_skip_permissions)}
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

                        <div style={flagRowStyle}>
                            <div>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Plan Mode</div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>Read-only — analyse and plan, never edit files</div>
                            </div>
                            <button
                                type="button"
                                style={toggleStyle(planMode)}
                                onClick={() => setPlanMode(p => !p)}
                                title="Toggle plan mode"
                            >
                                <span style={{
                                    position: 'absolute', top: '3px',
                                    left: planMode ? '17px' : '3px',
                                    width: '12px', height: '12px', borderRadius: '50%',
                                    background: '#fff', transition: 'left 0.15s',
                                }} />
                            </button>
                        </div>

                        <div style={flagRowStyle}>
                            <div>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Verbose</div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>--verbose — detailed claude output</div>
                            </div>
                            <button
                                type="button"
                                style={toggleStyle(!!flags.verbose)}
                                onClick={() => setFlag('verbose', !flags.verbose)}
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

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                        <button type="submit" disabled={loading || isAtLimit} style={{ ...submitBtnStyle, opacity: (loading || isAtLimit) ? 0.5 : 1, cursor: isAtLimit ? 'not-allowed' : 'pointer' }}>
                            {loading ? 'Adding…' : 'Add Agent'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
