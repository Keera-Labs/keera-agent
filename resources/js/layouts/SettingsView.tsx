import { useEffect, useRef, useState } from 'react'
import { color } from '@/tokens'
import { MODELS } from '@/types/agent'
import PluginsTab from './views/PluginsTab'

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
    plan_mode: boolean
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

const labelClass = 'text-zinc-500 text-[11px] uppercase tracking-[0.05em]'
const inputClass = 'bg-canvas border border-stroke rounded text-zinc-900 text-[13px] py-1.5 px-2.5 font-mono outline-none'
const cancelBtnClass = 'bg-transparent border border-stroke rounded text-zinc-500 text-[12px] py-1.5 px-3.5 cursor-pointer'
const submitBtnClass = 'bg-success border border-success rounded text-white text-[12px] py-1.5 px-3.5 cursor-pointer'
const flagRowClass = 'flex items-center justify-between py-1.5 px-2.5 rounded bg-canvas border border-stroke cursor-pointer'
const toggleClass = (on: boolean) =>
    `w-8 h-[18px] rounded-[9px] border-none cursor-pointer relative shrink-0 transition-colors duration-150 ${on ? 'bg-accent' : 'bg-stroke'}`

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
            className={`flex flex-wrap gap-[5px] items-center bg-canvas border border-stroke rounded py-1.5 px-2 min-h-[38px] cursor-text ${disabled ? 'opacity-50' : 'opacity-100'}`}
        >
            {tags.map((tag, i) => (
                <span key={i}
                    className="inline-flex items-center gap-1 rounded-sm py-0.5 px-1.5 font-mono text-[11px] leading-[1.4]"
                    style={{
                        background: tagColor + '22', border: `1px solid ${tagColor}55`,
                        color: tagColor,
                    }}>
                    {tag}
                    {!disabled && (
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); onChange(tags.filter((_, j) => j !== i)) }}
                            className="bg-transparent border-none cursor-pointer p-0 leading-none text-[12px] flex items-center opacity-70"
                            style={{ color: tagColor }}
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
                    className="bg-transparent border-none outline-none py-0.5 px-0 font-mono text-[11px] text-zinc-900 min-w-[120px] flex-1"
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
    const [tplPlanMode, setTplPlanMode] = useState(false)
    const [formError, setFormError] = useState('')
    const [saving, setSaving] = useState(false)
    const [syncing, setSyncing] = useState(false)

    function reload() {
        return fetch('/api/agent-templates')
            .then(r => r.json())
            .then(data => { setTemplates(data); setLoading(false); return data as AgentTemplate[] })
            .catch(() => { setLoading(false); return [] as AgentTemplate[] })
    }

    useEffect(() => { reload() }, [])

    async function syncFromDefaults() {
        setSyncing(true)
        try {
            await fetch('/api/agent-templates/sync-defaults', { method: 'POST' })
            await reload()
            setSelected(null); setIsNew(false)
        } finally { setSyncing(false) }
    }

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
        <div className="flex-1 flex overflow-hidden">
            {/* Left list */}
            <div className="w-[220px] shrink-0 border-r border-stroke flex flex-col overflow-hidden">
                <div className="p-2.5 border-b border-stroke flex flex-col gap-1.5">
                    <button onClick={startNew} className={`${submitBtnClass} w-full text-center py-1.5 px-0`}>
                        + New Template
                    </button>
                    <button
                        onClick={syncFromDefaults}
                        disabled={syncing}
                        title="Re-pull code defaults into the built-in templates, overwriting manual edits"
                        className={`${cancelBtnClass} w-full text-center py-1.5 px-0 ${syncing ? 'opacity-60' : 'opacity-100'}`}
                    >
                        {syncing ? 'Syncing…' : 'Sync from defaults'}
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {loading && (
                        <div className="py-3 px-4 text-zinc-400 text-[12px]">Loading…</div>
                    )}
                    {templates.map(tpl => {
                        const active = !isNew && selected?.id === tpl.id
                        return (
                            <button
                                key={tpl.id}
                                onClick={() => loadTemplate(tpl)}
                                className={`w-full text-left border-l-2 py-[9px] px-3 cursor-pointer flex flex-col gap-[3px] ${active ? 'bg-canvas border-accent' : 'bg-transparent border-transparent'}`}
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className="text-zinc-900 text-[12px] font-medium flex-1 truncate">
                                        {tpl.name}
                                    </span>
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
                            Built-in template — your edits are saved and persist across restarts. It can’t be deleted.
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto py-[18px] px-6 flex flex-col gap-3.5">
                        {formError && <span className="text-danger text-[12px]">{formError}</span>}

                        <div className="flex gap-2.5">
                            <label className="flex-1 flex flex-col gap-1">
                                <span className={labelClass}>Name *</span>
                                <input value={tplName} disabled={!canEdit} onChange={e => setTplName(e.target.value)}
                                    className={`${inputClass} w-full box-border ${canEdit ? 'opacity-100' : 'opacity-55'}`} />
                            </label>
                            <label className="flex-1 flex flex-col gap-1">
                                <span className={labelClass}>Type</span>
                                <select value={tplType} disabled={!canEdit} onChange={e => setTplType(e.target.value)}
                                    className={`${inputClass} w-full box-border ${canEdit ? 'opacity-100' : 'opacity-55'}`}>
                                    {Object.entries(AGENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </label>
                        </div>

                        <label className="flex flex-col gap-1">
                            <span className={labelClass}>Description</span>
                            <input value={tplDesc} disabled={!canEdit} onChange={e => setTplDesc(e.target.value)}
                                placeholder="Short description of this template's role…"
                                className={`${inputClass} w-full box-border ${canEdit ? 'opacity-100' : 'opacity-55'}`} />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className={labelClass}>Model</span>
                            <select value={tplModel} disabled={!canEdit} onChange={e => setTplModel(e.target.value)}
                                className={`${inputClass} w-full box-border ${canEdit ? 'opacity-100' : 'opacity-55'}`}>
                                {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className={labelClass}>System Prompt</span>
                            <textarea value={tplPrompt} disabled={!canEdit} onChange={e => setTplPrompt(e.target.value)}
                                placeholder="Instructions passed to Claude when an agent using this template starts…"
                                rows={9}
                                className={`${inputClass} w-full box-border resize-y leading-[1.6] font-mono text-[11px] ${canEdit ? 'opacity-100' : 'opacity-55'}`} />
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
                                        className={`${inputClass} w-[72px] text-center py-1 px-2`} />
                                </div>
                            </div>
                        )}
                    </div>
                    {canEdit && (
                        <div className="py-3 px-6 border-t border-stroke flex gap-2 justify-end shrink-0">
                            {canDelete && (
                                <button onClick={deleteTemplate} className={`${cancelBtnClass} text-danger border-danger`}>
                                    Delete
                                </button>
                            )}
                            <button onClick={saveTemplate} disabled={saving} className={`${submitBtnClass} ${saving ? 'opacity-60' : 'opacity-100'}`}>
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
        <div className="flex-1 overflow-y-auto py-7 px-8">
            <div className="max-w-[560px] flex flex-col gap-[18px]">
                <div>
                    <h3 className="mt-0 mx-0 mb-1.5 text-zinc-900 text-[14px] font-semibold">Default Permissions</h3>
                    <p className="m-0 text-zinc-500 text-[12px] leading-[1.6]">
                        Allow/deny rules applied globally to all projects and agents. Changing these syncs to every project and agent in the database.
                    </p>
                </div>

                {error && <span className="text-danger text-[12px]">{error}</span>}

                <div className="flex flex-col gap-1">
                    <span className={labelClass}>Allow</span>
                    <TagInput
                        tags={allow}
                        onChange={setAllow}
                        placeholder={fetching ? '' : 'e.g. Bash(npm run *)'}
                        disabled={fetching}
                        tagColor={color.success}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <span className={labelClass}>Deny</span>
                    <TagInput
                        tags={deny}
                        onChange={setDeny}
                        placeholder={fetching ? '' : 'e.g. Bash(rm *)'}
                        disabled={fetching}
                        tagColor={color.danger}
                    />
                </div>

                <p className="m-0 text-zinc-400 text-[11px] leading-[1.6]">
                    Rules follow Claude Code syntax, e.g.{' '}
                    <code className="font-[monospace] text-accent">Bash(*)</code>,{' '}
                    <code className="font-[monospace] text-accent">Bash(npm run *)</code>,{' '}
                    <code className="font-[monospace] text-accent">Read</code>.{' '}
                    Press Enter to add a rule. Leave both empty to rely on interactive prompts.
                </p>

                <div>
                    <button
                        onClick={save}
                        disabled={fetching || saving}
                        className={`${submitBtnClass} min-w-[140px] ${(fetching || saving) ? 'opacity-60' : 'opacity-100'}`}
                    >
                        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Permissions'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Main SettingsView ────────────────────────────────────────────────────────

type SettingsTab = 'templates' | 'permissions' | 'plugins'

export default function SettingsView() {
    const [tab, setTab] = useState<SettingsTab>('templates')

    const tabBtnClass = (t: SettingsTab) =>
        `rounded text-[12px] py-1 px-4 cursor-pointer ${tab === t ? 'bg-canvas border border-stroke text-zinc-900' : 'bg-transparent border border-transparent text-zinc-500'}`

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-surface">
            {/* Settings header */}
            <div className="py-3.5 px-6 border-b border-stroke flex items-center gap-4 shrink-0 bg-canvas">
                <span className="text-zinc-900 text-[15px] font-semibold">Settings</span>
                <div className="flex gap-1">
                    <button className={tabBtnClass('templates')} onClick={() => setTab('templates')}>Templates</button>
                    <button className={tabBtnClass('permissions')} onClick={() => setTab('permissions')}>Default Permissions</button>
                    <button className={tabBtnClass('plugins')} onClick={() => setTab('plugins')}>Plugins</button>
                </div>
            </div>

            {/* Tab content */}
            {tab === 'templates' && <TemplatesTab />}
            {tab === 'permissions' && <DefaultPermissionsTab />}
            {tab === 'plugins' && <PluginsTab />}
        </div>
    )
}
