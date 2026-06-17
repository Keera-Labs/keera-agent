import { useEffect, useRef, useState } from 'react'
import { color } from '@/tokens'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentFlags {
    dangerously_skip_permissions?: boolean
    plan_mode?: boolean
    verbose?: boolean
    max_turns?: number | null
}

export interface AgentTemplate {
    id: number
    name: string
    description: string | null
    agent_type: string
    system_prompt: string | null
    model: string
    flags: AgentFlags
    is_builtin: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_TYPE_LABELS: Record<string, string> = {
    pm: 'PM',
    software_engineer: 'Software Engineer',
    qa: 'QA',
}

const AGENT_TYPE_COLORS: Record<string, string> = {
    pm: '#58a6ff',
    software_engineer: '#3fb950',
    qa: '#ffa657',
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
    color: color.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
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

// ─── TagInput ─────────────────────────────────────────────────────────────────

function TagInput({
    tags, onChange, placeholder, disabled, tagColor,
}: {
    tags: string[]
    onChange: (tags: string[]) => void
    placeholder?: string
    disabled?: boolean
    tagColor: string
}) {
    const [input, setInput] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    function addTag(raw: string) {
        const value = raw.trim()
        if (value && !tags.includes(value)) onChange([...tags, value])
        setInput('')
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') { e.preventDefault(); addTag(input) }
        else if ((e.key === 'Backspace' || e.key === 'Delete') && input === '' && tags.length > 0) {
            onChange(tags.slice(0, -1))
        }
    }

    return (
        <div
            onClick={() => inputRef.current?.focus()}
            style={{
                display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center',
                background: color.bgBase, border: `1px solid ${color.borderMuted}`, borderRadius: '6px',
                padding: '6px 8px', minHeight: '38px', cursor: 'text',
                opacity: disabled ? 0.5 : 1,
            }}
        >
            {tags.map((tag, i) => (
                <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    background: tagColor + '22', border: `1px solid ${tagColor}55`,
                    borderRadius: '4px', padding: '2px 6px',
                    fontFamily: '"JetBrains Mono", monospace', fontSize: '11px',
                    color: tagColor, lineHeight: '1.4',
                }}>
                    {tag}
                    {!disabled && (
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); onChange(tags.filter((_, j) => j !== i)) }}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: tagColor, padding: '0', lineHeight: 1, fontSize: '12px',
                                display: 'flex', alignItems: 'center', opacity: 0.7,
                            }}
                        >×</button>
                    )}
                </span>
            ))}
            {!disabled && (
                <input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => { if (input.trim()) addTag(input) }}
                    placeholder={tags.length === 0 ? placeholder : ''}
                    style={{
                        background: 'none', border: 'none', outline: 'none', padding: '2px 0',
                        fontFamily: '"JetBrains Mono", monospace', fontSize: '11px',
                        color: color.textPrimary, minWidth: '120px', flex: 1,
                    }}
                />
            )}
        </div>
    )
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
    const [templates, setTemplates] = useState<AgentTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [selected, setSelected] = useState<AgentTemplate | null>(null)
    const [isNew, setIsNew] = useState(false)
    const [tplName, setTplName] = useState('')
    const [tplDesc, setTplDesc] = useState('')
    const [tplType, setTplType] = useState('software_engineer')
    const [tplModel, setTplModel] = useState('claude-opus-4-8')
    const [tplPrompt, setTplPrompt] = useState('')
    const [tplFlags, setTplFlags] = useState<AgentFlags>({})
    const [formError, setFormError] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        fetch('/api/agent-templates')
            .then(r => r.json())
            .then(data => { setTemplates(data); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    function loadTemplate(tpl: AgentTemplate) {
        setSelected(tpl); setIsNew(false)
        setTplName(tpl.name); setTplDesc(tpl.description ?? '')
        setTplType(tpl.agent_type); setTplModel(tpl.model)
        setTplPrompt(tpl.system_prompt ?? ''); setTplFlags(tpl.flags ?? {})
        setFormError('')
    }

    function startNew() {
        setSelected(null); setIsNew(true)
        setTplName(''); setTplDesc(''); setTplType('software_engineer')
        setTplModel('claude-opus-4-8'); setTplPrompt(''); setTplFlags({})
        setFormError('')
    }

    async function saveTemplate() {
        if (!tplName.trim()) { setFormError('Name is required'); return }
        setSaving(true); setFormError('')
        try {
            const body = { name: tplName, description: tplDesc, agent_type: tplType, model: tplModel, system_prompt: tplPrompt, flags: tplFlags }
            const url = isNew ? '/api/agent-templates' : `/api/agent-templates/${selected!.id}`
            const res = await fetch(url, { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { const d = await res.json(); setFormError(d.error ?? 'Save failed'); return }
            const tpl: AgentTemplate = await res.json()
            const updated = isNew ? [...templates, tpl] : templates.map(t => t.id === tpl.id ? tpl : t)
            setTemplates(updated)
            setIsNew(false); setSelected(tpl)
        } finally { setSaving(false) }
    }

    async function deleteTemplate() {
        if (!selected || selected.is_builtin) return
        const res = await fetch(`/api/agent-templates/${selected.id}`, { method: 'DELETE' })
        if (!res.ok) return
        setTemplates(templates.filter(t => t.id !== selected.id))
        setSelected(null); setIsNew(false)
    }

    const canEdit = isNew || selected !== null
    const canDelete = !isNew && selected !== null && !selected.is_builtin
    const showEditor = isNew || selected !== null

    return (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left list */}
            <div style={{ width: '220px', flexShrink: 0, borderRight: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '10px', borderBottom: `1px solid ${color.border}` }}>
                    <button onClick={startNew} style={{ ...submitBtnStyle, width: '100%', textAlign: 'center' as const, padding: '6px 0' }}>
                        + New Template
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading && (
                        <div style={{ padding: '12px 16px', color: color.textFaint, fontSize: '12px' }}>Loading…</div>
                    )}
                    {templates.map(tpl => {
                        const active = !isNew && selected?.id === tpl.id
                        return (
                            <button
                                key={tpl.id}
                                onClick={() => loadTemplate(tpl)}
                                style={{
                                    width: '100%', textAlign: 'left' as const, background: active ? color.bgCanvas : 'transparent',
                                    border: 'none', borderLeft: `2px solid ${active ? color.accent : 'transparent'}`,
                                    padding: '9px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '3px',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: color.textPrimary, fontSize: '12px', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                                        {tpl.name}
                                    </span>
                                    {tpl.is_builtin && <span style={{ color: color.textFaint, fontSize: '9px', letterSpacing: '0.03em' }}>built-in</span>}
                                </div>
                                <span style={{ color: AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textFaint, fontSize: '10px' }}>
                                    {AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Right editor */}
            {showEditor ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {selected?.is_builtin && (
                        <div style={{ padding: '7px 16px', background: color.bgCanvas, borderBottom: `1px solid ${color.border}`, color: color.textMuted, fontSize: '11px' }}>
                            Built-in template — your edits are saved and persist across restarts. It can’t be deleted.
                        </div>
                    )}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {formError && <span style={{ color: color.danger, fontSize: '12px' }}>{formError}</span>}

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={labelStyle}>Name *</span>
                                <input value={tplName} disabled={!canEdit} onChange={e => setTplName(e.target.value)}
                                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const, opacity: canEdit ? 1 : 0.55 }} />
                            </label>
                            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={labelStyle}>Type</span>
                                <select value={tplType} disabled={!canEdit} onChange={e => setTplType(e.target.value)}
                                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const, opacity: canEdit ? 1 : 0.55 }}>
                                    {Object.entries(AGENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </label>
                        </div>

                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Description</span>
                            <input value={tplDesc} disabled={!canEdit} onChange={e => setTplDesc(e.target.value)}
                                placeholder="Short description of this template's role…"
                                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const, opacity: canEdit ? 1 : 0.55 }} />
                        </label>

                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Model</span>
                            <select value={tplModel} disabled={!canEdit} onChange={e => setTplModel(e.target.value)}
                                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const, opacity: canEdit ? 1 : 0.55 }}>
                                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                                <option value="claude-opus-4-8">Claude Opus 4.8</option>
                                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                            </select>
                        </label>

                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>System Prompt</span>
                            <textarea value={tplPrompt} disabled={!canEdit} onChange={e => setTplPrompt(e.target.value)}
                                placeholder="Instructions passed to Claude when an agent using this template starts…"
                                rows={9}
                                style={{
                                    ...inputStyle, width: '100%', boxSizing: 'border-box' as const,
                                    resize: 'vertical' as const, lineHeight: 1.6,
                                    fontFamily: '"JetBrains Mono", monospace', fontSize: '11px',
                                    opacity: canEdit ? 1 : 0.55,
                                }} />
                        </label>

                        {canEdit && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <span style={labelStyle}>Launch Flags</span>
                                {([
                                    { key: 'dangerously_skip_permissions' as const, label: 'Skip Permissions', hint: '--dangerously-skip-permissions — no prompts' },
                                    { key: 'plan_mode' as const, label: 'Plan Mode', hint: 'Read-only — analyse and plan, never edit files' },
                                    { key: 'verbose' as const, label: 'Verbose', hint: '--verbose — detailed output' },
                                ] as const).map(({ key, label, hint }) => (
                                    <div key={key} style={flagRowStyle} onClick={() => setTplFlags(f => ({ ...f, [key]: !f[key] }))}>
                                        <div>
                                            <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>{label}</div>
                                            <div style={{ fontSize: '10px', color: color.textFaint }}>{hint}</div>
                                        </div>
                                        <button type="button" style={toggleStyle(!!tplFlags[key])} onClick={e => e.stopPropagation()}>
                                            <span style={{ position: 'absolute', top: '3px', left: tplFlags[key] ? '17px' : '3px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                                        </button>
                                    </div>
                                ))}
                                <div style={{ ...flagRowStyle, gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Max Turns</div>
                                        <div style={{ fontSize: '10px', color: color.textFaint }}>--max-turns N — limit conversation turns</div>
                                    </div>
                                    <input type="number" min={1} max={500} placeholder="∞"
                                        value={tplFlags.max_turns ?? ''}
                                        onChange={e => setTplFlags(f => ({ ...f, max_turns: e.target.value ? parseInt(e.target.value, 10) : null }))}
                                        onClick={e => e.stopPropagation()}
                                        style={{ ...inputStyle, width: '72px', textAlign: 'center' as const, padding: '4px 8px' }} />
                                </div>
                            </div>
                        )}
                    </div>
                    {canEdit && (
                        <div style={{ padding: '12px 24px', borderTop: `1px solid ${color.border}`, display: 'flex', gap: '8px', justifyContent: 'flex-end', flexShrink: 0 }}>
                            {canDelete && (
                                <button onClick={deleteTemplate} style={{ ...cancelBtnStyle, color: color.danger, borderColor: color.danger }}>
                                    Delete
                                </button>
                            )}
                            <button onClick={saveTemplate} disabled={saving} style={{ ...submitBtnStyle, opacity: saving ? 0.6 : 1 }}>
                                {saving ? 'Saving…' : isNew ? 'Create Template' : 'Save Changes'}
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: color.textFaint, fontSize: '13px' }}>Select a template to view, or create a new one</span>
                </div>
            )}
        </div>
    )
}

// ─── Default Permissions Tab ──────────────────────────────────────────────────

function DefaultPermissionsTab() {
    const [allow, setAllow] = useState<string[]>([])
    const [deny, setDeny] = useState<string[]>([])
    const [error, setError] = useState('')
    const [fetching, setFetching] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        fetch('/api/default-permissions')
            .then(r => r.json())
            .then(d => { setAllow(d.allow ?? []); setDeny(d.deny ?? []) })
            .catch(() => setError('Failed to load permissions'))
            .finally(() => setFetching(false))
    }, [])

    async function save() {
        setSaving(true); setError(''); setSaved(false)
        try {
            const res = await fetch('/api/default-permissions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ allow, deny }),
            })
            const d = await res.json()
            if (!res.ok) { setError(d.error ?? 'Save failed'); return }
            setAllow(d.allow ?? []); setDeny(d.deny ?? [])
            setSaved(true); setTimeout(() => setSaved(false), 2500)
        } catch { setError('Network error') }
        finally { setSaving(false) }
    }

    return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
            <div style={{ maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                    <h3 style={{ margin: '0 0 6px', color: color.textPrimary, fontSize: '14px', fontWeight: 600 }}>Default Permissions</h3>
                    <p style={{ margin: 0, color: color.textMuted, fontSize: '12px', lineHeight: 1.6 }}>
                        Allow/deny rules applied globally to all projects and agents. Changing these syncs to every project and agent in the database.
                    </p>
                </div>

                {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={labelStyle}>Allow</span>
                    <TagInput
                        tags={allow}
                        onChange={setAllow}
                        placeholder={fetching ? '' : 'e.g. Bash(npm run *)'}
                        disabled={fetching}
                        tagColor={color.success}
                    />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={labelStyle}>Deny</span>
                    <TagInput
                        tags={deny}
                        onChange={setDeny}
                        placeholder={fetching ? '' : 'e.g. Bash(rm *)'}
                        disabled={fetching}
                        tagColor={color.danger}
                    />
                </div>

                <p style={{ margin: 0, color: color.textFaint, fontSize: '11px', lineHeight: 1.6 }}>
                    Rules follow Claude Code syntax, e.g.{' '}
                    <code style={{ fontFamily: 'monospace', color: color.accent }}>Bash(*)</code>,{' '}
                    <code style={{ fontFamily: 'monospace', color: color.accent }}>Bash(npm run *)</code>,{' '}
                    <code style={{ fontFamily: 'monospace', color: color.accent }}>Read</code>.{' '}
                    Press Enter to add a rule. Leave both empty to rely on interactive prompts.
                </p>

                <div>
                    <button
                        onClick={save}
                        disabled={fetching || saving}
                        style={{ ...submitBtnStyle, opacity: (fetching || saving) ? 0.6 : 1, minWidth: '140px' }}
                    >
                        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Permissions'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Main SettingsView ────────────────────────────────────────────────────────

type SettingsTab = 'templates' | 'permissions'

export default function SettingsView() {
    const [tab, setTab] = useState<SettingsTab>('templates')

    const tabBtnStyle = (t: SettingsTab): React.CSSProperties => ({
        background: tab === t ? color.bgCanvas : 'transparent',
        border: `1px solid ${tab === t ? color.borderMuted : 'transparent'}`,
        borderRadius: '6px',
        color: tab === t ? color.textPrimary : color.textMuted,
        fontSize: '12px', padding: '4px 16px', cursor: 'pointer',
    })

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: color.bgSurface }}>
            {/* Settings header */}
            <div style={{
                padding: '14px 24px', borderBottom: `1px solid ${color.border}`,
                display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0,
                background: color.bgCanvas,
            }}>
                <span style={{ color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>Settings</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button style={tabBtnStyle('templates')} onClick={() => setTab('templates')}>Templates</button>
                    <button style={tabBtnStyle('permissions')} onClick={() => setTab('permissions')}>Default Permissions</button>
                </div>
            </div>

            {/* Tab content */}
            {tab === 'templates' && <TemplatesTab />}
            {tab === 'permissions' && <DefaultPermissionsTab />}
        </div>
    )
}
