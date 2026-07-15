import type { MouseEvent, ReactNode } from 'react'
import { RotateCw, CircleDot, GitMerge, ArrowRight } from 'lucide-react'
import { color } from '@/tokens'
import type { ProjectAgent } from '@/queries/agentQuery'
import { AgentEditModal } from './AgentEditModal'
import { agentAvatarColor, agentInitials, agentRoleLabel, PLACEHOLDER } from './presentation'

// ─── Footer action icon button (carried over from PR #207) ────────────────────

function CardIconButton({
    title, onClick, hoverColor = color.textPrimary, children,
}: {
    title: string
    onClick: (e: MouseEvent) => void
    hoverColor?: string
    children: ReactNode
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={e => { e.stopPropagation(); onClick(e) }}
            className="bg-transparent border border-stroke text-zinc-500 cursor-pointer w-[30px] h-[30px] rounded-md flex items-center justify-center shrink-0 transition-[color,background,border-color] duration-100"
            onMouseEnter={e => { e.currentTarget.style.color = hoverColor; e.currentTarget.style.borderColor = hoverColor; e.currentTarget.style.background = color.bgCanvas }}
            onMouseLeave={e => { e.currentTarget.style.color = color.textMuted; e.currentTarget.style.borderColor = color.stroke; e.currentTarget.style.background = 'transparent' }}
        >
            {children}
        </button>
    )
}

// ─── Status pill (Active / Waiting) ───────────────────────────────────────────

function StatusPill({ running }: { running: boolean }) {
    const tone = running
        ? { bg: '#e7f6ec', fg: '#16a34a', label: 'Active' }
        : { bg: color.warningSubtle, fg: color.warningBright, label: 'Waiting' }
    return (
        <span
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold py-1 px-2.5 rounded-full shrink-0"
            style={{ background: tone.bg, color: tone.fg }}
        >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.fg }} />
            {tone.label}
        </span>
    )
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
    const isPlaceholder = value === PLACEHOLDER
    return (
        <div className="flex flex-col gap-[3px] min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-zinc-400">
                {label}
            </span>
            <span className={`text-[13px] font-mono truncate ${isPlaceholder ? 'text-zinc-400' : 'text-zinc-900'}`}>
                {value}
            </span>
        </div>
    )
}

// ─── Agent card ───────────────────────────────────────────────────────────────

export interface AgentCardStats {
    runtime: string
    model: string
    branch: string
    usage: string
}

export function AgentCard({
    agent, running, statusLine, stats, adoptPending,
    onOpen, onRestart, onAdopt,
}: {
    agent: ProjectAgent
    running: boolean
    statusLine: string | null
    stats: AgentCardStats
    adoptPending: boolean
    onOpen: () => void
    onRestart: () => void
    onAdopt: () => void
}) {
    const dividerClass = 'h-px bg-stroke border-0 m-0'

    return (
        <article className="flex flex-col gap-4 bg-surface border border-stroke rounded-[16px] py-[22px] px-6">
            {/* Header: avatar + name/role + status */}
            <div className="flex items-center gap-[13px]">
                <div
                    className="w-[46px] h-[46px] rounded-xl shrink-0 flex items-center justify-center text-[15px] font-bold text-white tracking-[0.02em]"
                    style={{ background: agentAvatarColor(agent) }}
                >
                    {agentInitials(agent.name)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[16px] font-bold text-zinc-900 truncate">
                        {agent.name}
                    </div>
                    <div className="text-[13px] text-zinc-500 mt-px truncate">
                        {agentRoleLabel(agent)}
                    </div>
                </div>
                <StatusPill running={running} />
            </div>

            {/* Status / description line */}
            <p className={`m-0 text-[13.5px] leading-[1.55] ${statusLine ? 'text-zinc-700' : 'text-zinc-400'}`}>
                {statusLine ?? 'No status reported.'}
            </p>

            <hr className={dividerClass} />

            {/* Stats: RUNTIME · MODEL / BRANCH · USAGE */}
            <div className="grid grid-cols-2 gap-4">
                <Stat label="Runtime" value={stats.runtime} />
                <Stat label="Model" value={stats.model} />
                <Stat label="Branch" value={stats.branch} />
                <Stat label="Usage" value={stats.usage} />
            </div>

            <hr className={dividerClass} />

            {/* Footer: action icons + Open link */}
            <div className="flex items-center gap-2">
                <CardIconButton
                    title={running ? 'Restart agent' : 'Start agent'}
                    hoverColor="#ca8a04"
                    onClick={onRestart}
                >
                    <RotateCw size={14}/>
                </CardIconButton>

                <AgentEditModal
                    agent={agent}
                    trigger={
                        <button
                            type="button"
                            title="Edit agent"
                            className="bg-transparent border border-stroke text-zinc-500 cursor-pointer w-[30px] h-[30px] rounded-md flex items-center justify-center shrink-0 transition-[color,background,border-color] duration-100 hover:text-zinc-900 hover:border-zinc-900 hover:bg-canvas"
                        >
                            <CircleDot size={14}/>
                        </button>
                    }
                />

                <CardIconButton
                    title="Adopt work — remove worktree, check out the agent branch"
                    hoverColor="#16a34a"
                    onClick={() => { if (!adoptPending) onAdopt() }}
                >
                    <GitMerge size={14}/>
                </CardIconButton>

                <button
                    type="button"
                    onClick={onOpen}
                    className="ml-auto bg-transparent border-0 text-blue-600 cursor-pointer text-[13.5px] font-semibold flex items-center gap-[5px] py-1 px-0.5 hover:opacity-70"
                >
                    Open
                    <ArrowRight size={14}/>
                </button>
            </div>
        </article>
    )
}
