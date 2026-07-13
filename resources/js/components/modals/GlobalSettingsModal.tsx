import { useState, useEffect } from 'react'
import { router, usePage } from '@inertiajs/react'
import { color } from '@/tokens'
import type { AgentTemplate } from '@/types/agent'
import type { AgentFlags } from '@/queries/agents'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, MODELS } from '@/types/agent'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'
import { TagInput } from '@/components/ui/TagInput'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'

export function GlobalSettingsModal({
    onClose,
    initialTemplates,
}: {
    onClose: () => void
    initialTemplates: AgentTemplate[]
    // Still accepted from ModalLayer for compatibility; the editor now manages the
    // global list itself and syncs the effective list via refetchAgentTemplates.
    onTemplatesChange?: (templates: AgentTemplate[]) => void
}) {
    type SettingsTab = 'general' | 'templates' | 'permissions'
    const [tab, setTab] = useState<SettingsTab>('general')
    const [templates, setTemplates] = useState<AgentTemplate[]>(initialTemplates)

    // ── General settings — seeded from Inertia props, no extra fetch needed ───
    const { props: pageProps } = usePage<{ global_settings?: { max_agents_per_project?: number } }>()
    const serverMax = pageProps.global_settings?.max_agents_per_project ?? 10
    const [maxAgents, setMaxAgents] = useState<number>(serverMax)
    const [generalSaving, setGeneralSaving] = useState(false)
    const [generalSaved, setGeneralSaved] = useState(false)
    const [generalError, setGeneralError] = useState('')

    // Update the global layout context so AgentAddModal warning refreshes immediately
    const { setMaxAgentsPerProject, refetchAgentTemplates } = useAppLayout()
    const [syncing, setSyncing] = useState(false)

    // This is the GLOBAL editor: always load the global list (project_id NULL),
    // independent of the context's effective (project-resolved) list.
    async function reloadGlobals(): Promise<AgentTemplate[]> {
        const res = await fetch('/api/agent-templates')
        const data: AgentTemplate[] = res.ok ? await res.json() : []
        setTemplates(data)
        refetchAgentTemplates()  // keep AgentAddModal's effective list in sync
        return data
    }

    useEffect(() => { reloadGlobals() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    async function syncFromDefaults() {
        setSyncing(true)
        try {
            await fetch('/api/agent-templates/sync-defaults', { method: 'POST' })
            await reloadGlobals()
            setSelected(null); setIsNew(false)
        } finally { setSyncing(false) }
    }

    async function saveGeneralSettings() {
        setGeneralSaving(true)
        setGeneralError('')
        setGeneralSaved(false)
        try {
            const res = await fetch('/api/global-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ max_agents_per_project: maxAgents }),
            })
            const d = await res.json()
            if (!res.ok) { setGeneralError(d.error ?? 'Save failed'); return }
            setGeneralSaved(true)
            setTimeout(() => setGeneralSaved(false), 2000)
            // Update context immediately so AgentAddModal warning reflects the new
            // limit without waiting for router.reload() to complete.
            setMaxAgentsPerProject(d.max_agents_per_project ?? maxAgents)
            // Also re-fetch Inertia props so the page-level value stays in sync
            router.reload({ only: ['global_settings'] })
        } catch { setGeneralError('Network error') }
        finally { setGeneralSaving(false) }
    }

    // ── Template editor ───────────────────────────────────────────────────────
    const [selected, setSelected] = useState<AgentTemplate | null>(null)
    const [isNew, setIsNew] = useState(false)
    const [tplName, setTplName] = useState('')
    const [tplDesc, setTplDesc] = useState('')
    const [tplType, setTplType] = useState('software_engineer')
    const [tplModel, setTplModel] = useState('claude-opus-4-8')
    const [tplPrompt, setTplPrompt] = useState('')
    const [tplFlags, setTplFlags] = useState<AgentFlags>({})
    const [tplPlanMode, setTplPlanMode] = useState(false)
    const [formError, setFormError] = useState('')
    const [saving, setSaving] = useState(false)

    // ── Permissions ───────────────────────────────────────────────────────────
    const [permAllow, setPermAllow] = useState<string[]>([])
    const [permDeny, setPermDeny] = useState<string[]>([])
    const [permError, setPermError] = useState('')
    const [permFetching, setPermFetching] = useState(true)
    const [permSaving, setPermSaving] = useState(false)
    const [permSaved, setPermSaved] = useState(false)

    useEffect(() => {
        fetch('/api/default-permissions')
            .then(r => r.json())
            .then(d => { setPermAllow(d.allow ?? []); setPermDeny(d.deny ?? []) })
            .catch(() => setPermError('Failed to load'))
            .finally(() => setPermFetching(false))
    }, [])

    function loadTemplate(tpl: AgentTemplate) {
        setSelected(tpl); setIsNew(false)
        setTplName(tpl.name); setTplDesc(tpl.description ?? '')
        setTplType(tpl.agent_type); setTplModel(tpl.model)
        setTplPrompt(tpl.system_prompt ?? ''); setTplFlags(tpl.flags ?? {})
        setTplPlanMode(!!tpl.plan_mode)
        setFormError('')
    }

    function startNew() {
        setSelected(null); setIsNew(true)
        setTplName(''); setTplDesc(''); setTplType('software_engineer')
        setTplModel('claude-opus-4-8'); setTplPrompt(''); setTplFlags({})
        setTplPlanMode(false)
        setFormError('')
    }

    async function saveTemplate() {
        if (!tplName.trim()) { setFormError('Name is required'); return }
        setSaving(true); setFormError('')
        try {
            const body = { name: tplName, description: tplDesc, agent_type: tplType, model: tplModel, system_prompt: tplPrompt, flags: tplFlags, plan_mode: tplPlanMode }
            const url = isNew ? '/api/agent-templates' : `/api/agent-templates/${selected!.id}`
            const res = await fetch(url, { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { const d = await res.json(); setFormError(d.error ?? 'Save failed'); return }
            const tpl: AgentTemplate = await res.json()
            await reloadGlobals()
            setIsNew(false); setSelected(tpl)
        } finally { setSaving(false) }
    }

    async function deleteTemplate() {
        if (!selected || selected.is_builtin) return
        const res = await fetch(`/api/agent-templates/${selected.id}`, { method: 'DELETE' })
        if (!res.ok) return
        await reloadGlobals()
        setSelected(null); setIsNew(false)
    }

    async function savePermissions() {
        setPermSaving(true); setPermError(''); setPermSaved(false)
        try {
            const res = await fetch('/api/default-permissions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ allow: permAllow, deny: permDeny }),
            })
            const d = await res.json()
            if (!res.ok) { setPermError(d.error ?? 'Save failed'); return }
            setPermAllow(d.allow ?? []); setPermDeny(d.deny ?? [])
            setPermSaved(true); setTimeout(() => setPermSaved(false), 2000)
        } catch { setPermError('Network error') }
        finally { setPermSaving(false) }
    }

    const canEdit = isNew || (selected !== null && !selected.is_builtin)
    const showEditor = isNew || selected !== null

    const tabBtnStyle = (t: SettingsTab): React.CSSProperties => ({
        background: tab === t ? color.bgCanvas : 'transparent',
        border: tab === t ? `1px solid ${color.borderMuted}` : '1px solid transparent',
        borderRadius: '6px', color: tab === t ? color.textPrimary : color.textMuted,
        fontSize: '12px', padding: '4px 14px', cursor: 'pointer',
    })

    return (
        <div
            style={{ position: 'fixed', inset: 0, background: color.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div style={{
                background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '10px',
                width: '880px', height: '620px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${color.border}`, gap: '12px', flexShrink: 0 }}>
                    <span style={{ color: color.textPrimary, fontSize: '14px', fontWeight: 600 }}>Settings</span>
                    <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                        <button style={tabBtnStyle('general')} onClick={() => setTab('general')}>General</button>
                        <button style={tabBtnStyle('templates')} onClick={() => setTab('templates')}>Templates</button>
                        <button style={tabBtnStyle('permissions')} onClick={() => setTab('permissions')}>Default Permissions</button>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: color.textFaint, cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 4px' }}>×</button>
                </div>

                {/* ── General tab ── */}
                {tab === 'general' && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '400px' }}>
                            <p style={{ margin: 0, color: color.textMuted, fontSize: '11px' }}>
                                Global settings that apply across all projects.
                            </p>
                            {generalError && <span style={{ color: color.danger, fontSize: '12px' }}>{generalError}</span>}
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={labelStyle}>Max agents per project</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={maxAgents}
                                    onChange={e => setMaxAgents(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                    style={{ ...inputStyle, width: '120px' }}
                                />
                                <span style={{ color: color.textFaint, fontSize: '10px', lineHeight: 1.5 }}>
                                    Maximum number of agents (excluding deleted) allowed in a single project. Default: 10.
                                </span>
                            </label>
                            <div>
                                <button
                                    onClick={saveGeneralSettings}
                                    disabled={generalSaving}
                                    style={{ ...submitBtnStyle, opacity: generalSaving ? 0.6 : 1, minWidth: '120px' }}
                                >
                                    {generalSaving ? 'Saving…' : generalSaved ? 'Saved ✓' : 'Save Settings'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Templates tab ── */}
                {tab === 'templates' && (
                    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                        {/* Left list */}
                        <div style={{ width: '220px', flexShrink: 0, borderRight: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ padding: '10px', borderBottom: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <button onClick={startNew} style={{ ...submitBtnStyle, width: '100%', textAlign: 'center' as const, padding: '6px 0' }}>
                                    + New Template
                                </button>
                                <button
                                    onClick={syncFromDefaults}
                                    disabled={syncing}
                                    title="Re-pull code defaults into the built-in templates, overwriting manual edits"
                                    style={{ ...cancelBtnStyle, width: '100%', textAlign: 'center' as const, padding: '6px 0', opacity: syncing ? 0.6 : 1 }}
                                >
                                    {syncing ? 'Syncing…' : 'Sync from defaults'}
                                </button>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto' }}>
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
                                                <span style={{ color: color.textPrimary, fontSize: '12px', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{tpl.name}</span>
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
                                        Built-in templates are read-only.
                                    </div>
                                )}
                                <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
                                            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                    </label>

                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={labelStyle}>System Prompt</span>
                                        <textarea value={tplPrompt} disabled={!canEdit} onChange={e => setTplPrompt(e.target.value)}
                                            placeholder="Instructions passed to Claude when an agent using this template starts…"
                                            rows={9}
                                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const,
                                                lineHeight: 1.6, fontFamily: '"JetBrains Mono", monospace', fontSize: '11px', opacity: canEdit ? 1 : 0.55 }} />
                                    </label>

                                    {canEdit && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <span style={labelStyle}>Launch Flags</span>
                                            {([
                                                { key: 'dangerously_skip_permissions' as const, label: 'Skip Permissions', hint: '--dangerously-skip-permissions — no prompts' },
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
                                            <div style={flagRowStyle} onClick={() => setTplPlanMode(p => !p)}>
                                                <div>
                                                    <div style={{ fontSize: '12px', fontWeight: 500, color: color.textSecondary }}>Plan Mode</div>
                                                    <div style={{ fontSize: '10px', color: color.textFaint }}>Read-only — analyse and plan, never edit files</div>
                                                </div>
                                                <button type="button" style={toggleStyle(tplPlanMode)} onClick={e => e.stopPropagation()}>
                                                    <span style={{ position: 'absolute', top: '3px', left: tplPlanMode ? '17px' : '3px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                                                </button>
                                            </div>
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
                                    <div style={{ padding: '12px 20px', borderTop: `1px solid ${color.border}`, display: 'flex', gap: '8px', justifyContent: 'flex-end', flexShrink: 0 }}>
                                        {!isNew && (
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
                )}

                {/* ── Permissions tab ── */}
                {tab === 'permissions' && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '520px' }}>
                            <p style={{ margin: 0, color: color.textMuted, fontSize: '11px' }}>
                                Default allow/deny rules applied to all projects and agents. Changing these syncs to every project and agent in the database.
                            </p>
                            {permError && <span style={{ color: color.danger, fontSize: '12px' }}>{permError}</span>}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={labelStyle}>Allow</span>
                                <TagInput tags={permAllow} onChange={setPermAllow}
                                    placeholder={permFetching ? '' : 'e.g. Bash(npm run *)'}
                                    disabled={permFetching} tagColor={color.success} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={labelStyle}>Deny</span>
                                <TagInput tags={permDeny} onChange={setPermDeny}
                                    placeholder={permFetching ? '' : 'e.g. Bash(rm *)'}
                                    disabled={permFetching} tagColor={color.danger} />
                            </div>
                            <p style={{ margin: 0, color: color.textFaint, fontSize: '10px', lineHeight: 1.5 }}>
                                Rules follow Claude Code syntax, e.g.{' '}
                                <code style={{ fontFamily: 'monospace' }}>Bash(*)</code>,{' '}
                                <code style={{ fontFamily: 'monospace' }}>Bash(npm run *)</code>,{' '}
                                <code style={{ fontFamily: 'monospace' }}>Read</code>.{' '}
                                Leave both empty to rely on interactive prompts.
                            </p>
                            <div>
                                <button onClick={savePermissions} disabled={permFetching || permSaving}
                                    style={{ ...submitBtnStyle, opacity: (permFetching || permSaving) ? 0.6 : 1, minWidth: '120px' }}>
                                    {permSaving ? 'Saving…' : permSaved ? 'Saved ✓' : 'Save Permissions'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
