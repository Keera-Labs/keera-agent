import { useEffect, useState, type ReactNode } from 'react'
import { color } from '@/tokens'
import Modal from '@/components/ui/Modal'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { type ProjectAgent, type AgentFlags, normalizeAgent } from '@/queries/agentQuery'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, MODELS } from '@/types/agent'
import { labelClass, inputClass, cancelBtnClass, submitBtnClass, flagRowClass, toggleClass } from '@/components/ui/styles'

function EditAgentForm({ agent, onSaved, close }: {
    agent: ProjectAgent
    onSaved: (updated: ProjectAgent) => void
    close: () => void
}) {
    const [name, setName] = useState(agent.name)
    const [agentType, setAgentType] = useState(agent.agent_type)
    const [description, setDescription] = useState(agent.description ?? '')
    const [model, setModel] = useState(agent.model ?? 'claude-opus-4-8')
    const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt ?? '')
    const [flags, setFlags] = useState<AgentFlags>(agent.flags ?? {})
    const [planMode, setPlanMode] = useState(!!agent.plan_mode)
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
        setPlanMode(!!agent.plan_mode)
        setError('')
    }, [agent.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
                    plan_mode: planMode,
                }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            onSaved(normalizeAgent(data.data))
            close()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">Edit Agent</h2>

            {error && <span className="text-danger text-[12px]">{error}</span>}

            {/* Type selector */}
            <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Type</span>
                <div className="flex gap-2 flex-wrap">
                    {Object.entries(AGENT_TYPE_LABELS).map(([type, label]) => {
                        const active = agentType === type
                        return (
                            <button
                                key={type}
                                type="button"
                                onClick={() => setAgentType(type)}
                                className={`py-[5px] px-3 rounded border text-[12px] cursor-pointer ${active ? 'font-semibold' : 'font-normal'}`}
                                style={{
                                    borderColor: active ? AGENT_TYPE_COLORS[type] ?? color.accent : color.borderMuted,
                                    background: active ? `${AGENT_TYPE_COLORS[type] ?? color.accent}18` : 'transparent',
                                    color: active ? (AGENT_TYPE_COLORS[type] ?? color.accent) : color.textMuted,
                                }}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>
            </label>

            {/* Name */}
            <label className="flex flex-col gap-1">
                <span className={labelClass}>Name</span>
                <input
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Agent name"
                    required
                    className={`${inputClass} w-full box-border`}
                />
            </label>

            {/* Description */}
            <label className="flex flex-col gap-1">
                <span className={labelClass}>Description</span>
                <input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Short description"
                    className={`${inputClass} w-full box-border`}
                />
            </label>

            {/* Model */}
            <label className="flex flex-col gap-1">
                <span className={labelClass}>Model</span>
                <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className={`${inputClass} w-full box-border`}
                >
                    {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
            </label>

            {/* System Prompt */}
            <label className="flex flex-col gap-1">
                <span className={labelClass}>System Prompt</span>
                <textarea
                    value={systemPrompt}
                    onChange={e => setSystemPrompt(e.target.value)}
                    placeholder="Instructions for this agent… (leave blank to use none)"
                    rows={6}
                    className={`${inputClass} w-full box-border resize-y leading-normal`}
                />
            </label>

            {/* Launch Options */}
            <div className="flex flex-col gap-1.5">
                <span className={labelClass}>Launch Options</span>

                {/* Skip Permissions */}
                <div
                    className={flagRowClass}
                    onClick={() => setFlag('dangerously_skip_permissions', !flags.dangerously_skip_permissions)}
                >
                    <div>
                        <div className="text-[12px] font-medium text-zinc-700">Skip Permissions</div>
                        <div className="text-[10px] text-zinc-400">--dangerously-skip-permissions — no prompts</div>
                    </div>
                    <button
                        type="button"
                        className={toggleClass(!!flags.dangerously_skip_permissions)}
                        onClick={e => e.stopPropagation()}
                        title="Toggle --dangerously-skip-permissions"
                    >
                        <span
                            className="absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150"
                            style={{ left: flags.dangerously_skip_permissions ? '17px' : '3px' }}
                        />
                    </button>
                </div>

                {/* Plan Mode */}
                <div
                    className={flagRowClass}
                    onClick={() => setPlanMode(p => !p)}
                >
                    <div>
                        <div className="text-[12px] font-medium text-zinc-700">Plan Mode</div>
                        <div className="text-[10px] text-zinc-400">Read-only — analyse and plan, never edit files</div>
                    </div>
                    <button
                        type="button"
                        className={toggleClass(planMode)}
                        onClick={e => e.stopPropagation()}
                        title="Toggle plan mode"
                    >
                        <span
                            className="absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150"
                            style={{ left: planMode ? '17px' : '3px' }}
                        />
                    </button>
                </div>

                {/* Verbose */}
                <div
                    className={flagRowClass}
                    onClick={() => setFlag('verbose', !flags.verbose)}
                >
                    <div>
                        <div className="text-[12px] font-medium text-zinc-700">Verbose</div>
                        <div className="text-[10px] text-zinc-400">--verbose — detailed claude output</div>
                    </div>
                    <button
                        type="button"
                        className={toggleClass(!!flags.verbose)}
                        onClick={e => e.stopPropagation()}
                        title="Toggle --verbose"
                    >
                        <span
                            className="absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150"
                            style={{ left: flags.verbose ? '17px' : '3px' }}
                        />
                    </button>
                </div>

                {/* Max Turns */}
                <div className={`${flagRowClass} gap-3`}>
                    <div className="flex-1">
                        <div className="text-[12px] font-medium text-zinc-700">Max Turns</div>
                        <div className="text-[10px] text-zinc-400">--max-turns N — limit conversation turns</div>
                    </div>
                    <input
                        type="number"
                        min={1}
                        max={500}
                        placeholder="∞"
                        value={flags.max_turns ?? ''}
                        onChange={e => setFlag('max_turns', e.target.value ? parseInt(e.target.value, 10) : null)}
                        className={`${inputClass} w-[72px] text-center`}
                        style={{ padding: '4px 8px' }}
                    />
                </div>
            </div>

            {/* Footer */}
            <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={close} className={cancelBtnClass}>Cancel</button>
                <button type="submit" disabled={loading} className={submitBtnClass} style={{ opacity: loading ? 0.7 : 1 }}>
                    {loading ? 'Saving…' : 'Save Changes'}
                </button>
            </div>
        </form>
    )
}

const editPanelClassName = 'bg-modal border border-stroke rounded-lg p-6 w-[600px] max-w-[95vw] max-h-[90vh] overflow-y-auto flex flex-col'

/**
 * Self-contained "Edit Agent" modal. Renders its own `trigger` and owns the
 * open state via the reusable Modal; saving routes through the layout's agent
 * mutation hook. Wrap the trigger in a stop-propagation container when it lives
 * inside a clickable row so opening the modal doesn't also trigger the row.
 */
export function AgentEditModal({ agent, trigger, onOpenChange }: {
    agent: ProjectAgent
    trigger: ReactNode
    onOpenChange?: (open: boolean) => void
}) {
    const { agentHook } = useAppLayout()
    return (
        <Modal
            trigger={trigger}
            ariaLabel="Edit agent"
            onOpenChange={onOpenChange}
            panelClassName={editPanelClassName}
        >
            {close => (
                <EditAgentForm
                    agent={agent}
                    onSaved={updated => agentHook.update.mutate({ agentId: updated.id, ...updated })}
                    close={close}
                />
            )}
        </Modal>
    )
}

export default AgentEditModal
