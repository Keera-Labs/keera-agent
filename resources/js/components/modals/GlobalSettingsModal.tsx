import { useState, useEffect } from 'react'
import { router, usePage } from '@inertiajs/react'
import { color } from '@/tokens'
import type { AgentTemplate } from '@/types/agent'
import type { AgentFlags } from '@/queries/agentQuery'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, MODELS } from '@/types/agent'
import { labelClass, inputClass, cancelBtnClass, submitBtnClass, flagRowClass, toggleClass } from '@/components/ui/styles'
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

    const tabBtnClass = (t: SettingsTab): string =>
        `rounded text-[12px] py-1 px-3.5 cursor-pointer border ${tab === t ? 'bg-canvas border-stroke text-zinc-900' : 'bg-transparent border-transparent text-zinc-500'}`

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]"
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div className="bg-modal border border-stroke rounded-lg w-[880px] h-[620px] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center py-3.5 px-5 border-b border-stroke gap-3 shrink-0">
                    <span className="text-zinc-900 text-[14px] font-semibold">Settings</span>
                    <div className="flex gap-1 flex-1">
                        <button className={tabBtnClass('general')} onClick={() => setTab('general')}>General</button>
                        <button className={tabBtnClass('templates')} onClick={() => setTab('templates')}>Templates</button>
                        <button className={tabBtnClass('permissions')} onClick={() => setTab('permissions')}>Default Permissions</button>
                    </div>
                    <button onClick={onClose} className="bg-transparent border-none text-zinc-400 cursor-pointer text-[18px] leading-none py-0 px-1">×</button>
                </div>

                {/* ── General tab ── */}
                {tab === 'general' && (
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="flex flex-col gap-3.5 max-w-[400px]">
                            <p className="m-0 text-zinc-500 text-[11px]">
                                Global settings that apply across all projects.
                            </p>
                            {generalError && <span className="text-danger text-[12px]">{generalError}</span>}
                            <label className="flex flex-col gap-1">
                                <span className={labelClass}>Max agents per project</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={maxAgents}
                                    onChange={e => setMaxAgents(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                    className={`${inputClass} w-[120px]`}
                                />
                                <span className="text-zinc-400 text-[10px] leading-normal">
                                    Maximum number of agents (excluding deleted) allowed in a single project. Default: 10.
                                </span>
                            </label>
                            <div>
                                <button
                                    onClick={saveGeneralSettings}
                                    disabled={generalSaving}
                                    className={`${submitBtnClass} min-w-[120px]`}
                                    style={{ opacity: generalSaving ? 0.6 : 1 }}
                                >
                                    {generalSaving ? 'Saving…' : generalSaved ? 'Saved ✓' : 'Save Settings'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Templates tab ── */}
                {tab === 'templates' && (
                    <div className="flex-1 flex overflow-hidden">
                        {/* Left list */}
                        <div className="w-[220px] shrink-0 border-r border-stroke flex flex-col overflow-hidden">
                            <div className="p-2.5 border-b border-stroke flex flex-col gap-1.5">
                                <button onClick={startNew} className={`${submitBtnClass} w-full text-center`} style={{ padding: '6px 0' }}>
                                    + New Template
                                </button>
                                <button
                                    onClick={syncFromDefaults}
                                    disabled={syncing}
                                    title="Re-pull code defaults into the built-in templates, overwriting manual edits"
                                    className={`${cancelBtnClass} w-full text-center`}
                                    style={{ padding: '6px 0', opacity: syncing ? 0.6 : 1 }}
                                >
                                    {syncing ? 'Syncing…' : 'Sync from defaults'}
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                {templates.map(tpl => {
                                    const active = !isNew && selected?.id === tpl.id
                                    return (
                                        <button
                                            key={tpl.id}
                                            onClick={() => loadTemplate(tpl)}
                                            className={`w-full text-left border-0 border-l-2 border-solid py-[9px] px-3 cursor-pointer flex flex-col gap-[3px] ${active ? 'bg-canvas border-l-accent' : 'bg-transparent border-l-transparent'}`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-zinc-900 text-[12px] font-medium flex-1 truncate">{tpl.name}</span>
                                                {tpl.is_builtin && <span className="text-zinc-400 text-[9px] tracking-[0.03em]">built-in</span>}
                                            </div>
                                            <span className="text-[10px]" style={{ color: AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textFaint }}>
                                                {AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Right editor */}
                        {showEditor ? (
                            <div className="flex-1 flex flex-col overflow-hidden">
                                {selected?.is_builtin && (
                                    <div className="py-[7px] px-4 bg-canvas border-b border-stroke text-zinc-500 text-[11px]">
                                        Built-in templates are read-only.
                                    </div>
                                )}
                                <div className="flex-1 overflow-y-auto py-[18px] px-5 flex flex-col gap-3.5">
                                    {formError && <span className="text-danger text-[12px]">{formError}</span>}

                                    <div className="flex gap-2.5">
                                        <label className="flex-1 flex flex-col gap-1">
                                            <span className={labelClass}>Name *</span>
                                            <input value={tplName} disabled={!canEdit} onChange={e => setTplName(e.target.value)}
                                                className={`${inputClass} w-full box-border ${canEdit ? 'opacity-100' : 'opacity-[0.55]'}`} />
                                        </label>
                                        <label className="flex-1 flex flex-col gap-1">
                                            <span className={labelClass}>Type</span>
                                            <select value={tplType} disabled={!canEdit} onChange={e => setTplType(e.target.value)}
                                                className={`${inputClass} w-full box-border ${canEdit ? 'opacity-100' : 'opacity-[0.55]'}`}>
                                                {Object.entries(AGENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                            </select>
                                        </label>
                                    </div>

                                    <label className="flex flex-col gap-1">
                                        <span className={labelClass}>Description</span>
                                        <input value={tplDesc} disabled={!canEdit} onChange={e => setTplDesc(e.target.value)}
                                            placeholder="Short description of this template's role…"
                                            className={`${inputClass} w-full box-border ${canEdit ? 'opacity-100' : 'opacity-[0.55]'}`} />
                                    </label>

                                    <label className="flex flex-col gap-1">
                                        <span className={labelClass}>Model</span>
                                        <select value={tplModel} disabled={!canEdit} onChange={e => setTplModel(e.target.value)}
                                            className={`${inputClass} w-full box-border ${canEdit ? 'opacity-100' : 'opacity-[0.55]'}`}>
                                            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                    </label>

                                    <label className="flex flex-col gap-1">
                                        <span className={labelClass}>System Prompt</span>
                                        <textarea value={tplPrompt} disabled={!canEdit} onChange={e => setTplPrompt(e.target.value)}
                                            placeholder="Instructions passed to Claude when an agent using this template starts…"
                                            rows={9}
                                            className={`${inputClass} w-full box-border resize-y leading-[1.6] ${canEdit ? 'opacity-100' : 'opacity-[0.55]'}`}
                                            style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '11px' }} />
                                    </label>

                                    {canEdit && (
                                        <div className="flex flex-col gap-1.5">
                                            <span className={labelClass}>Launch Flags</span>
                                            {([
                                                { key: 'dangerously_skip_permissions' as const, label: 'Skip Permissions', hint: '--dangerously-skip-permissions — no prompts' },
                                                { key: 'verbose' as const, label: 'Verbose', hint: '--verbose — detailed output' },
                                            ] as const).map(({ key, label, hint }) => (
                                                <div key={key} className={flagRowClass} onClick={() => setTplFlags(f => ({ ...f, [key]: !f[key] }))}>
                                                    <div>
                                                        <div className="text-[12px] font-medium text-zinc-700">{label}</div>
                                                        <div className="text-[10px] text-zinc-400">{hint}</div>
                                                    </div>
                                                    <button type="button" className={toggleClass(!!tplFlags[key])} onClick={e => e.stopPropagation()}>
                                                        <span className={`absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150 ${tplFlags[key] ? 'left-[17px]' : 'left-[3px]'}`} />
                                                    </button>
                                                </div>
                                            ))}
                                            <div className={flagRowClass} onClick={() => setTplPlanMode(p => !p)}>
                                                <div>
                                                    <div className="text-[12px] font-medium text-zinc-700">Plan Mode</div>
                                                    <div className="text-[10px] text-zinc-400">Read-only — analyse and plan, never edit files</div>
                                                </div>
                                                <button type="button" className={toggleClass(tplPlanMode)} onClick={e => e.stopPropagation()}>
                                                    <span className={`absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150 ${tplPlanMode ? 'left-[17px]' : 'left-[3px]'}`} />
                                                </button>
                                            </div>
                                            <div className={`${flagRowClass} gap-3`}>
                                                <div className="flex-1">
                                                    <div className="text-[12px] font-medium text-zinc-700">Max Turns</div>
                                                    <div className="text-[10px] text-zinc-400">--max-turns N — limit conversation turns</div>
                                                </div>
                                                <input type="number" min={1} max={500} placeholder="∞"
                                                    value={tplFlags.max_turns ?? ''}
                                                    onChange={e => setTplFlags(f => ({ ...f, max_turns: e.target.value ? parseInt(e.target.value, 10) : null }))}
                                                    onClick={e => e.stopPropagation()}
                                                    className={`${inputClass} w-[72px] text-center`}
                                                    style={{ padding: '4px 8px' }} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {canEdit && (
                                    <div className="py-3 px-5 border-t border-stroke flex gap-2 justify-end shrink-0">
                                        {!isNew && (
                                            <button onClick={deleteTemplate} className={cancelBtnClass} style={{ color: color.danger, borderColor: color.danger }}>
                                                Delete
                                            </button>
                                        )}
                                        <button onClick={saveTemplate} disabled={saving} className={submitBtnClass} style={{ opacity: saving ? 0.6 : 1 }}>
                                            {saving ? 'Saving…' : isNew ? 'Create Template' : 'Save Changes'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center">
                                <span className="text-zinc-400 text-[13px]">Select a template to view, or create a new one</span>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Permissions tab ── */}
                {tab === 'permissions' && (
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="flex flex-col gap-3.5 max-w-[520px]">
                            <p className="m-0 text-zinc-500 text-[11px]">
                                Default allow/deny rules applied to all projects and agents. Changing these syncs to every project and agent in the database.
                            </p>
                            {permError && <span className="text-danger text-[12px]">{permError}</span>}
                            <div className="flex flex-col gap-1">
                                <span className={labelClass}>Allow</span>
                                <TagInput tags={permAllow} onChange={setPermAllow}
                                    placeholder={permFetching ? '' : 'e.g. Bash(npm run *)'}
                                    disabled={permFetching} tagColor={color.success} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className={labelClass}>Deny</span>
                                <TagInput tags={permDeny} onChange={setPermDeny}
                                    placeholder={permFetching ? '' : 'e.g. Bash(rm *)'}
                                    disabled={permFetching} tagColor={color.danger} />
                            </div>
                            <p className="m-0 text-zinc-400 text-[10px] leading-normal">
                                Rules follow Claude Code syntax, e.g.{' '}
                                <code className="font-[monospace]">Bash(*)</code>,{' '}
                                <code className="font-[monospace]">Bash(npm run *)</code>,{' '}
                                <code className="font-[monospace]">Read</code>.{' '}
                                Leave both empty to rely on interactive prompts.
                            </p>
                            <div>
                                <button onClick={savePermissions} disabled={permFetching || permSaving}
                                    className={`${submitBtnClass} min-w-[120px]`}
                                    style={{ opacity: (permFetching || permSaving) ? 0.6 : 1 }}>
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
