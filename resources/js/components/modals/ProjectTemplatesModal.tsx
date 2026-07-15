import { useEffect, useState } from 'react'
import { color } from '@/tokens'
import type { AgentTemplate, AgentFlags } from '@/types/agent'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, MODELS } from '@/types/agent'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { labelClass, inputClass, cancelBtnClass, submitBtnClass, flagRowClass, toggleClass } from '@/components/ui/styles'

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
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]"
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div className="bg-modal border border-stroke rounded-md w-[760px] max-w-[95vw] h-[560px] max-h-[90vh] flex flex-col overflow-hidden">
                <div className="py-4 px-5 border-b border-stroke flex items-center justify-between">
                    <div>
                        <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">Agent Templates</h2>
                        <p className="mt-0.5 mx-0 mb-0 text-zinc-500 text-[12px]">
                            Project: <span className="text-accent">{projectName}</span> — edits here stay in this project (copy-on-write).
                        </p>
                    </div>
                    <button onClick={resetAll} className={cancelBtnClass} style={{ color: color.danger, borderColor: color.danger }} title="Remove all project overrides and revert to global templates">
                        Reset all to global
                    </button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* List */}
                    <div className="w-[240px] shrink-0 border-r border-stroke flex flex-col overflow-hidden">
                        <div className="p-2.5">
                            <button onClick={startNew} className={`${submitBtnClass} w-full`} style={{ padding: '6px 0' }}>+ New (project only)</button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {loading && <div className="p-3 text-zinc-400 text-[12px]">Loading…</div>}
                            {templates.map(tpl => {
                                const active = !isNew && selected?.id === tpl.id
                                return (
                                    <button
                                        key={tpl.id}
                                        onClick={() => load(tpl)}
                                        className={`w-full text-left border-0 border-l-2 border-solid py-[9px] px-3 cursor-pointer flex flex-col gap-[3px] ${active ? 'bg-canvas border-l-accent' : 'bg-transparent border-l-transparent'}`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-zinc-900 text-[12px] font-medium flex-1 truncate">{tpl.name}</span>
                                            {tpl.is_override && <span className="text-accent text-[9px] font-semibold">OVERRIDE</span>}
                                            {!tpl.is_override && tpl.is_builtin && <span className="text-zinc-400 text-[9px]">global</span>}
                                        </div>
                                        <span className="text-[10px]" style={{ color: AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textFaint }}>{AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Editor */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {showEditor ? (
                            <>
                                <div className="flex-1 overflow-y-auto py-4 px-5 flex flex-col gap-3">
                                    {error && <span className="text-danger text-[12px]">{error}</span>}
                                    {selected?.is_override && (
                                        <div className="text-[11px] text-zinc-500 bg-canvas border border-stroke rounded py-[7px] px-2.5">
                                            Project override — shadows a global template. Use Revert to drop it.
                                        </div>
                                    )}
                                    <div className="flex gap-2.5">
                                        <label className="flex-1 flex flex-col gap-1">
                                            <span className={labelClass}>Name</span>
                                            <input value={name} onChange={e => setName(e.target.value)} className={inputClass} />
                                        </label>
                                        <label className="flex-1 flex flex-col gap-1">
                                            <span className={labelClass}>Type</span>
                                            <select value={type} onChange={e => setType(e.target.value)} className={inputClass}>
                                                {Object.entries(AGENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                            </select>
                                        </label>
                                    </div>
                                    <label className="flex flex-col gap-1">
                                        <span className={labelClass}>Description</span>
                                        <input value={desc} onChange={e => setDesc(e.target.value)} className={inputClass} />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className={labelClass}>Model</span>
                                        <select value={model} onChange={e => setModel(e.target.value)} className={inputClass}>
                                            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className={labelClass}>System Prompt</span>
                                        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={6} className={`${inputClass} resize-y leading-normal`} />
                                    </label>
                                    <div className={flagRowClass} onClick={() => setFlag('dangerously_skip_permissions', !flags.dangerously_skip_permissions)}>
                                        <div>
                                            <div className="text-[12px] font-medium text-zinc-700">Skip Permissions</div>
                                            <div className="text-[10px] text-zinc-400">--dangerously-skip-permissions — no prompts</div>
                                        </div>
                                        <button type="button" className={toggleClass(!!flags.dangerously_skip_permissions)} onClick={e => e.stopPropagation()}>
                                            <span className={`absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150 ${flags.dangerously_skip_permissions ? 'left-[17px]' : 'left-[3px]'}`} />
                                        </button>
                                    </div>
                                    <div className={flagRowClass} onClick={() => setPlanMode(p => !p)}>
                                        <div>
                                            <div className="text-[12px] font-medium text-zinc-700">Plan Mode</div>
                                            <div className="text-[10px] text-zinc-400">Read-only — analyse and plan, never edit files</div>
                                        </div>
                                        <button type="button" className={toggleClass(planMode)} onClick={e => e.stopPropagation()}>
                                            <span className={`absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150 ${planMode ? 'left-[17px]' : 'left-[3px]'}`} />
                                        </button>
                                    </div>
                                </div>
                                <div className="py-3 px-5 border-t border-stroke flex gap-2 justify-end">
                                    {selected?.is_override && (
                                        <button onClick={() => revertOverride(selected)} className={`${cancelBtnClass} mr-auto`} style={{ color: color.danger, borderColor: color.danger }}>
                                            Revert to global
                                        </button>
                                    )}
                                    <button onClick={onClose} className={cancelBtnClass}>Close</button>
                                    <button onClick={save} disabled={saving} className={submitBtnClass} style={{ opacity: saving ? 0.6 : 1 }}>
                                        {saving ? 'Saving…' : selected && !selected.is_override ? 'Save (creates override)' : 'Save'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-zinc-400 text-[13px] p-5 text-center">
                                Select a template to edit it for this project, or create a project-only one.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
