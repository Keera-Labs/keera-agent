import { useState, useEffect, useRef, type ReactNode } from 'react'
import { color } from '@/tokens'
import Modal from '@/components/ui/Modal'
import { useAppLayout } from '@/layouts/context/AppLayoutContext'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectAgent, AgentFlags } from '@/queries/agentQuery'
import { normalizeAgent } from '@/queries/agentQuery'
import type { AgentTemplate } from '@/types/agent'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from '@/types/agent'
import { labelClass, inputClass, cancelBtnClass, submitBtnClass, flagRowClass, toggleClass } from '@/components/ui/styles'

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

function AddAgentForm({ projectId, onCreated, close, templates, agentCount, maxAgents }: {
    projectId: number
    onCreated: (a: ProjectAgent) => void
    close: () => void
    templates: AgentTemplate[]
    agentCount?: number
    maxAgents?: number
}) {
    const [name, setName] = useState('')
    const [agentType, setAgentType] = useState<string>('software_engineer')
    const [description, setDescription] = useState(() => findBuiltinForType(templates, 'software_engineer')?.description ?? '')
    const [systemPrompt, setSystemPrompt] = useState(() => findBuiltinForType(templates, 'software_engineer')?.system_prompt ?? '')
    const [complexity, setComplexity] = useState('medium')
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
            setFlags({})
            setPlanMode(false)
            return
        }
        setSelectedTemplateId(tpl.id)
        setAgentType(tpl.agent_type)
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
                body: JSON.stringify({ name, agent_type: agentType, description, system_prompt: systemPrompt, complexity, flags, plan_mode: planMode }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            onCreated(normalizeAgent(data.data))
            close()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    const templateCardClass = (active: boolean) =>
        `py-2 px-2.5 rounded border cursor-pointer shrink-0 min-w-[100px] max-w-[140px] text-left ${active ? 'border-accent' : 'border-stroke'} ${active ? '' : 'bg-canvas'}`

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">Add Agent</h2>
            {isAtLimit && (
                <div className="text-danger text-[12px] py-2 px-3 rounded" style={{ background: `${color.danger}14`, border: `1px solid ${color.danger}40` }}>
                    Agent limit reached ({agentCount}/{maxAgents}). Delete an existing agent before adding a new one.
                </div>
            )}
            {error && <span className="text-danger text-[12px]">{error}</span>}

            {/* Template selector */}
            {templates.length > 0 && (
                <label className="flex flex-col gap-1.5">
                    <span className={labelClass}>Template</span>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        <button
                            key="blank"
                            type="button"
                            onClick={() => applyTemplate(null)}
                            className={templateCardClass(selectedTemplateId === null && !systemPrompt)}
                            style={(selectedTemplateId === null && !systemPrompt) ? { background: `${color.accent}18` } : undefined}
                        >
                            <div className="text-[11px] font-semibold text-zinc-700">Blank</div>
                            <div className="text-[10px] text-zinc-400 mt-0.5">Start from scratch</div>
                        </button>
                        {templates.map(tpl => {
                            const active = selectedTemplateId === tpl.id
                            const typeColor = AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textMuted
                            return (
                                <button
                                    key={tpl.id}
                                    type="button"
                                    onClick={() => applyTemplate(tpl)}
                                    className={templateCardClass(active)}
                                    style={active ? { background: `${color.accent}18` } : undefined}
                                >
                                    <div className={`text-[11px] font-semibold ${active ? 'text-accent' : 'text-zinc-700'}`}>
                                        {tpl.name}
                                    </div>
                                    <div className="text-[10px] mt-0.5" style={{ color: typeColor }}>
                                        {AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type}
                                    </div>
                                    {(tpl.flags?.dangerously_skip_permissions || tpl.plan_mode) && (
                                        <div className="flex gap-[3px] mt-1 flex-wrap">
                                            {tpl.flags?.dangerously_skip_permissions && (
                                                <span className="text-[9px] py-px px-1 rounded-[3px] bg-[#ff6b3518] text-[#ff6b35] font-semibold">FULL AUTO</span>
                                            )}
                                            {tpl.plan_mode && (
                                                <span className="text-[9px] py-px px-1 rounded-[3px] text-accent font-semibold" style={{ background: `${color.accent}18` }}>PLAN ONLY</span>
                                            )}
                                        </div>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </label>
            )}

            <label className="flex flex-col gap-1">
                <span className={labelClass}>Name</span>
                <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={agentType === 'pm' ? 'e.g. Alice' : agentType === 'qa' ? 'e.g. QA Bot' : 'e.g. Dev Agent'}
                    required
                    className={inputClass}
                />
            </label>

            <label className="flex flex-col gap-1">
                <span className={labelClass}>Description</span>
                <input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Short description"
                    className={inputClass}
                />
            </label>

            <label className="flex flex-col gap-1">
                <span className={labelClass}>Complexity</span>
                <select value={complexity} onChange={e => setComplexity(e.target.value)} className={inputClass}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                </select>
            </label>

            <label className="flex flex-col gap-1">
                <span className={labelClass}>System Prompt</span>
                <textarea
                    value={systemPrompt}
                    onChange={e => setSystemPrompt(e.target.value)}
                    placeholder="Instructions for this agent…"
                    rows={6}
                    className={`${inputClass} resize-y leading-normal`}
                />
            </label>

            {/* Launch Options */}
            <div className="flex flex-col gap-1.5">
                <span className={labelClass}>Launch Options</span>

                <div className={flagRowClass}>
                    <div>
                        <div className="text-[12px] font-medium text-zinc-700">Skip Permissions</div>
                        <div className="text-[10px] text-zinc-400">--dangerously-skip-permissions — no prompts</div>
                    </div>
                    <button
                        type="button"
                        className={toggleClass(!!flags.dangerously_skip_permissions)}
                        onClick={() => setFlag('dangerously_skip_permissions', !flags.dangerously_skip_permissions)}
                        title="Toggle --dangerously-skip-permissions"
                    >
                        <span
                            className="absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150"
                            style={{ left: flags.dangerously_skip_permissions ? '17px' : '3px' }}
                        />
                    </button>
                </div>

                <div className={flagRowClass}>
                    <div>
                        <div className="text-[12px] font-medium text-zinc-700">Plan Mode</div>
                        <div className="text-[10px] text-zinc-400">Read-only — analyse and plan, never edit files</div>
                    </div>
                    <button
                        type="button"
                        className={toggleClass(planMode)}
                        onClick={() => setPlanMode(p => !p)}
                        title="Toggle plan mode"
                    >
                        <span
                            className="absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150"
                            style={{ left: planMode ? '17px' : '3px' }}
                        />
                    </button>
                </div>

                <div className={flagRowClass}>
                    <div>
                        <div className="text-[12px] font-medium text-zinc-700">Verbose</div>
                        <div className="text-[10px] text-zinc-400">--verbose — detailed claude output</div>
                    </div>
                    <button
                        type="button"
                        className={toggleClass(!!flags.verbose)}
                        onClick={() => setFlag('verbose', !flags.verbose)}
                        title="Toggle --verbose"
                    >
                        <span
                            className="absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150"
                            style={{ left: flags.verbose ? '17px' : '3px' }}
                        />
                    </button>
                </div>

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

            <div className="flex gap-2 justify-end">
                <button type="button" onClick={close} className={cancelBtnClass}>Cancel</button>
                <button type="submit" disabled={loading || isAtLimit} className={submitBtnClass} style={{ opacity: (loading || isAtLimit) ? 0.5 : 1, cursor: isAtLimit ? 'not-allowed' : 'pointer' }}>
                    {loading ? 'Adding…' : 'Add Agent'}
                </button>
            </div>
        </form>
    )
}

const addPanelClassName = 'bg-modal border border-stroke rounded-lg p-6 w-[520px] max-h-[90vh] overflow-y-auto flex flex-col'

/**
 * Self-contained "Add Agent" modal. Renders its own `trigger` and owns the
 * open state via the reusable Modal. Reads the project, templates and agent
 * mutations from layout context — no parent visibility state needed.
 *
 * When there is no active project the trigger is rendered inert (no modal),
 * so callers can still show a disabled button.
 */
export function AgentAddModal({ trigger, onOpenChange }: {
    trigger: ReactNode
    onOpenChange?: (open: boolean) => void
}) {
    const { agentTemplates, agentHook, maxAgentsPerProject } = useAppLayout()
    const activeProject = useProjectStore(s => s.activeProject)

    if (activeProject?.id == null) return <>{trigger}</>

    const projectId = activeProject.id
    return (
        <Modal
            trigger={trigger}
            ariaLabel="Add agent"
            onOpenChange={onOpenChange}
            panelClassName={addPanelClassName}
        >
            {close => (
                <AddAgentForm
                    projectId={projectId}
                    templates={agentTemplates}
                    agentCount={agentHook.agents.length}
                    maxAgents={maxAgentsPerProject}
                    onCreated={agent => agentHook.addAgent(agent)}
                    close={close}
                />
            )}
        </Modal>
    )
}
