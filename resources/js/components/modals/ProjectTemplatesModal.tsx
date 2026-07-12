import { useEffect, useState } from 'react'
import { color } from '@/tokens'
import type { AgentTemplate, AgentFlags } from '@/types/agent'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, MODELS } from '@/types/agent'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'

/**
 * Per-project agent-template manager. The list is the project's EFFECTIVE
 * templates (overrides resolved over globals). Editing is copy-on-write: saving
 * a global forks a project override on the backend; saving an override updates
 * it in place. "Revert" drops a single override; "Reset all" drops every
 * override so the project falls back entirely to the globals.
 */
export function ProjectTemplatesModal({
    projectId,
    projectName,
    onClose,
}: {
    projectId: number
    projectName: string
    onClose: () => void
}) {
    const { refetchAgentTemplates } = useAppLayout()
    const [templates, setTemplates] = useState<AgentTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [selected, setSelected] = useState<AgentTemplate | null>(null)
    const [isNew, setIsNew] = useState(false)

    const [name, setName] = useState('')
    const [desc, setDesc] = useState('')
    const [type, setType] = useState('software_engineer')
    const [model, setModel] = useState('claude-opus-4-8')
    const [prompt, setPrompt] = useState('')
    const [flags, setFlags] = useState<AgentFlags>({})
    const [planMode, setPlanMode] = useState(false)
    const [error, setError] = useState('')
    const [saving, setSaving] = useState(false)

    async function reload() {
        const res = await fetch(`/api/projects/${projectId}/agent-templates`)
        const data: AgentTemplate[] = res.ok ? await res.json() : []
        setTemplates(data)
        setLoading(false)
        refetchAgentTemplates()
        return data
    }

    useEffect(() => { reload() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

    function load(tpl: AgentTemplate) {
        setSelected(tpl); setIsNew(false); setError('')
        setName(tpl.name); setDesc(tpl.description ?? ''); setType(tpl.agent_type)
        setModel(tpl.model ?? 'claude-opus-4-8'); setPrompt(tpl.system_prompt ?? '')
        setFlags(tpl.flags ?? {}); setPlanMode(!!tpl.plan_mode)
    }

    function startNew() {
        setSelected(null); setIsNew(true); setError('')
        setName(''); setDesc(''); setType('software_engineer')
        setModel('claude-opus-4-8'); setPrompt(''); setFlags({}); setPlanMode(false)
    }

    async function save() {
        if (!name.trim()) { setError('Name is required'); return }
        setSaving(true); setError('')
        const payload = {
            name: name.trim(), description: desc.trim() || null, agent_type: type,
            model, system_prompt: prompt.trim() || null, flags, plan_mode: planMode,
        }
        try {
            // Copy-on-write: PATCH against the effective row id forks/updates the
            // project override; POST creates a project-only template.
            const url = isNew || !selected
                ? `/api/projects/${projectId}/agent-templates`
                : `/api/projects/${projectId}/agent-templates/${selected.id}`
            const res = await fetch(url, {
                method: isNew || !selected ? 'POST' : 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            if (!res.ok) { setError((await res.json()).error ?? 'Save failed'); return }
            const saved: AgentTemplate = await res.json()
            const list = await reload()
            setSelected(list.find(t => t.id === saved.id) ?? saved); setIsNew(false)
        } catch { setError('Network error') } finally { setSaving(false) }
    }

    async function revertOverride(tpl: AgentTemplate) {
        await fetch(`/api/projects/${projectId}/agent-templates/${tpl.id}`, { method: 'DELETE' })
        await reload()
        setSelected(null); setIsNew(false)
    }

    async function resetAll() {
        await fetch(`/api/projects/${projectId}/agent-templates/reset`, { method: 'POST' })
        await reload()
        setSelected(null); setIsNew(false)
    }

    const showEditor = isNew || selected !== null
    const setFlag = (k: keyof AgentFlags, v: boolean) => setFlags(p => ({ ...p, [k]: v }))

    return (
        <div
            style={{ position: 'fixed', inset: 0, background: color.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div style={{ background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px', width: '760px', maxWidth: '95vw', height: '560px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>Agent Templates</h2>
                        <p style={{ margin: '2px 0 0', color: color.textMuted, fontSize: '12px' }}>
                            Project: <span style={{ color: color.accent }}>{projectName}</span> — edits here stay in this project (copy-on-write).
                        </p>
                    </div>
                    <button onClick={resetAll} style={{ ...cancelBtnStyle, color: color.danger, borderColor: color.danger }} title="Remove all project overrides and revert to global templates">
                        Reset all to global
                    </button>
                </div>

                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                    {/* List */}
                    <div style={{ width: '240px', flexShrink: 0, borderRight: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <div style={{ padding: '10px' }}>
                            <button onClick={startNew} style={{ ...submitBtnStyle, width: '100%', padding: '6px 0' }}>+ New (project only)</button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {loading && <div style={{ padding: '12px', color: color.textFaint, fontSize: '12px' }}>Loading…</div>}
                            {templates.map(tpl => {
                                const active = !isNew && selected?.id === tpl.id
                                return (
                                    <button key={tpl.id} onClick={() => load(tpl)} style={{ width: '100%', textAlign: 'left', background: active ? color.bgCanvas : 'transparent', border: 'none', borderLeft: `2px solid ${active ? color.accent : 'transparent'}`, padding: '9px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ color: color.textPrimary, fontSize: '12px', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.name}</span>
                                            {tpl.is_override && <span style={{ color: color.accent, fontSize: '9px', fontWeight: 600 }}>OVERRIDE</span>}
                                            {!tpl.is_override && tpl.is_builtin && <span style={{ color: color.textFaint, fontSize: '9px' }}>global</span>}
                                        </div>
                                        <span style={{ color: AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textFaint, fontSize: '10px' }}>{AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Editor */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {showEditor ? (
                            <>
                                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                                    {selected?.is_override && (
                                        <div style={{ fontSize: '11px', color: color.textMuted, background: color.bgCanvas, border: `1px solid ${color.borderMuted}`, borderRadius: '6px', padding: '7px 10px' }}>
                                            Project override — shadows a global template. Use Revert to drop it.
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <span style={labelStyle}>Name</span>
                                            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
                                        </label>
                                        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <span style={labelStyle}>Type</span>
                                            <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                                                {Object.entries(AGENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                            </select>
                                        </label>
                                    </div>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={labelStyle}>Description</span>
                                        <input value={desc} onChange={e => setDesc(e.target.value)} style={inputStyle} />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={labelStyle}>Model</span>
                                        <select value={model} onChange={e => setModel(e.target.value)} style={inputStyle}>
                                            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={labelStyle}>System Prompt</span>
                                        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={6} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
                                    </label>
                                    <div style={flagRowStyle} onClick={() => setFlag('dangerously_skip_permissions', !flags.dangerously_skip_permissions)}>
                                        <div>
                                            <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Skip Permissions</div>
                                            <div style={{ fontSize: '10px', color: color.textFaint }}>--dangerously-skip-permissions — no prompts</div>
                                        </div>
                                        <button type="button" style={toggleStyle(!!flags.dangerously_skip_permissions)} onClick={e => e.stopPropagation()}>
                                            <span style={{ position: 'absolute', top: '3px', left: flags.dangerously_skip_permissions ? '17px' : '3px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                                        </button>
                                    </div>
                                    <div style={flagRowStyle} onClick={() => setPlanMode(p => !p)}>
                                        <div>
                                            <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Plan Mode</div>
                                            <div style={{ fontSize: '10px', color: color.textFaint }}>Read-only — analyse and plan, never edit files</div>
                                        </div>
                                        <button type="button" style={toggleStyle(planMode)} onClick={e => e.stopPropagation()}>
                                            <span style={{ position: 'absolute', top: '3px', left: planMode ? '17px' : '3px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                                        </button>
                                    </div>
                                </div>
                                <div style={{ padding: '12px 20px', borderTop: `1px solid ${color.border}`, display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                    {selected?.is_override && (
                                        <button onClick={() => revertOverride(selected)} style={{ ...cancelBtnStyle, color: color.danger, borderColor: color.danger, marginRight: 'auto' }}>
                                            Revert to global
                                        </button>
                                    )}
                                    <button onClick={onClose} style={cancelBtnStyle}>Close</button>
                                    <button onClick={save} disabled={saving} style={{ ...submitBtnStyle, opacity: saving ? 0.6 : 1 }}>
                                        {saving ? 'Saving…' : selected && !selected.is_override ? 'Save (creates override)' : 'Save'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color.textFaint, fontSize: '13px', padding: '20px', textAlign: 'center' }}>
                                Select a template to edit it for this project, or create a project-only one.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
