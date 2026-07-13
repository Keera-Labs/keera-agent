import type { MouseEvent, ReactNode } from 'react'
import { RotateCw, CircleDot, GitMerge, ArrowRight } from 'lucide-react'
import { color } from '@/tokens'
import type { ProjectAgent } from '@/queries/agents'
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
            style={{
                background: 'transparent', border: `1px solid ${color.stroke}`,
                color: color.textMuted, cursor: 'pointer',
                width: '30px', height: '30px', borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'color 0.1s, background 0.1s, border-color 0.1s',
            }}
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
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: tone.bg, color: tone.fg,
            fontSize: '12px', fontWeight: 600,
            padding: '4px 10px', borderRadius: '999px', flexShrink: 0,
        }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: tone.fg }} />
            {tone.label}
        </span>
    )
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
    const isPlaceholder = value === PLACEHOLDER
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
            <span style={{
                fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.07em', color: color.textFaint,
            }}>
                {label}
            </span>
            <span style={{
                fontSize: '13px', fontFamily: '"JetBrains Mono", monospace',
                color: isPlaceholder ? color.textFaint : color.textPrimary,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
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
    onOpen, onRestart, onEdit, onAdopt,
}: {
    agent: ProjectAgent
    running: boolean
    statusLine: string | null
    stats: AgentCardStats
    adoptPending: boolean
    onOpen: () => void
    onRestart: () => void
    onEdit: () => void
    onAdopt: () => void
}) {
    const divider = { height: '1px', background: color.stroke, border: 'none', margin: 0 }

    return (
        <article style={{
            display: 'flex', flexDirection: 'column', gap: '16px',
            background: color.bgSurface, border: `1px solid ${color.stroke}`,
            borderRadius: '16px', padding: '22px 24px',
        }}>
            {/* Header: avatar + name/role + status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '13px' }}>
                <div style={{
                    width: '46px', height: '46px', borderRadius: '12px', flexShrink: 0,
                    background: agentAvatarColor(agent),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '15px', fontWeight: 700, color: '#fff', letterSpacing: '0.02em',
                }}>
                    {agentInitials(agent.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        fontSize: '16px', fontWeight: 700, color: color.textPrimary,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {agent.name}
                    </div>
                    <div style={{
                        fontSize: '13px', color: color.textMuted, marginTop: '1px',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {agentRoleLabel(agent)}
                    </div>
                </div>
                <StatusPill running={running} />
            </div>

            {/* Status / description line */}
            <p style={{
                margin: 0, fontSize: '13.5px', lineHeight: 1.55,
                color: statusLine ? color.textSecondary : color.textFaint,
            }}>
                {statusLine ?? 'No status reported.'}
            </p>

            <hr style={divider} />

            {/* Stats: RUNTIME · MODEL / BRANCH · USAGE */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: '16px', columnGap: '16px' }}>
                <Stat label="Runtime" value={stats.runtime} />
                <Stat label="Model" value={stats.model} />
                <Stat label="Branch" value={stats.branch} />
                <Stat label="Usage" value={stats.usage} />
            </div>

            <hr style={divider} />

            {/* Footer: action icons + Open link */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CardIconButton
                    title={running ? 'Restart agent' : 'Start agent'}
                    hoverColor="#ca8a04"
                    onClick={onRestart}
                >
                    <RotateCw size={14}/>
                </CardIconButton>

                <CardIconButton title="Edit agent" onClick={onEdit}>
                    <CircleDot size={14}/>
                </CardIconButton>

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
                    style={{
                        marginLeft: 'auto', background: 'transparent', border: 'none',
                        color: color.accentMuted, cursor: 'pointer',
                        fontSize: '13.5px', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 2px',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                    Open
                    <ArrowRight size={14}/>
                </button>
            </div>
        </article>
    )
}
