import { color } from '@/tokens'
import { AGENT_TYPE_COLORS } from '@/types/agent'
import { agentColor } from '@/utils/agentColor'
import { DotsIndicator } from '@/layouts/sidebar/Project'
import type {
    DashboardData,
    DashboardWorkingAgent,
    DashboardProject,
} from '@/pages/dashboard/placeholder'

// ─── Helpers ────────────────────────────────────────────────────────────────

function avatarColor(agentType: string, name: string): string {
    return AGENT_TYPE_COLORS[agentType] ?? agentColor(name)
}

function FolderIcon({ size = 13, fill = color.textMuted }: { size?: number; fill?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill={fill} style={{ flexShrink: 0 }}>
            <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z" />
        </svg>
    )
}

function projectStatusSummary(p: DashboardProject): string {
    const parts: string[] = []
    if (p.activeCount) parts.push(`${p.activeCount} active`)
    if (p.waitingCount) parts.push(`${p.waitingCount} waiting`)
    if (p.queuedCount) parts.push(`${p.queuedCount} queued`)
    if (p.doneCount) parts.push(`${p.doneCount} done`)
    return parts.join(' · ')
}

// ─── Stat card ──────────────────────────────────────────────────────────────

function StatCard({ label, value, dot }: { label: string; value: number; dot: string }) {
    return (
        <div style={{
            flex: 1, minWidth: 0,
            background: color.bgSurface,
            border: `1px solid ${color.border}`,
            borderRadius: '8px',
            padding: '14px 16px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
                <span style={{
                    color: color.textMuted, fontSize: '11px', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{label}</span>
            </div>
            <div style={{ color: color.textPrimary, fontSize: '28px', fontWeight: 700, lineHeight: 1 }}>
                {value}
            </div>
        </div>
    )
}

// ─── Working-now card ───────────────────────────────────────────────────────

function WorkingAgentCard({ agent }: { agent: DashboardWorkingAgent }) {
    const bg = avatarColor(agent.agentType, agent.name)
    return (
        <div style={{
            background: color.bgSurface,
            border: `1px solid ${color.border}`,
            borderRadius: '8px',
            padding: '14px',
            display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                    width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
                    background: bg, color: '#fff', fontSize: '12px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: '"JetBrains Mono", monospace',
                }}>{agent.initials}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        color: color.textPrimary, fontSize: '13px', fontWeight: 600,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{agent.name}</div>
                    <div style={{
                        color: color.textMuted, fontSize: '11px',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{agent.role}</div>
                </div>
                <span style={{
                    display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                    fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                    background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)',
                    color: color.success,
                }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color.success }} />
                    Active
                </span>
            </div>
            <div style={{ color: color.textSecondary, fontSize: '12px', lineHeight: 1.5 }}>
                {agent.description}
            </div>
            <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                color: color.textFaint, fontSize: '11px',
                fontFamily: '"JetBrains Mono", monospace',
            }}>
                <FolderIcon size={11} fill={color.textFaint} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent.project}
                </span>
                <span>·</span>
                <span>{agent.elapsed}</span>
            </div>
        </div>
    )
}

// ─── Project card ───────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: DashboardProject }) {
    const summary = projectStatusSummary(project)
    return (
        <div style={{
            background: color.bgSurface,
            border: `1px solid ${color.border}`,
            borderRadius: '8px',
            padding: '14px',
            display: 'flex', flexDirection: 'column', gap: '12px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FolderIcon />
                <span style={{
                    flex: 1, minWidth: 0,
                    color: color.textPrimary, fontSize: '13px', fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{project.name}</span>
                <span style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    background: project.online ? color.success : color.textGhost,
                }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {project.agents.map((a, i) => (
                    <span key={i} style={{
                        width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0,
                        background: avatarColor(a.agentType, a.initials), color: '#fff',
                        fontSize: '10px', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: '"JetBrains Mono", monospace',
                    }}>{a.initials}</span>
                ))}
                {project.extraAgents ? (
                    <span style={{
                        width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0,
                        background: color.bgCanvas, border: `1px solid ${color.border}`,
                        color: color.textMuted, fontSize: '10px', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: '"JetBrains Mono", monospace',
                    }}>+{project.extraAgents}</span>
                ) : null}
            </div>

            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                fontSize: '11px', color: color.textFaint,
                fontFamily: '"JetBrains Mono", monospace',
            }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {summary}
                </span>
                <span style={{ flexShrink: 0 }}>{project.lastActivity}</span>
            </div>
        </div>
    )
}

// ─── Section header ─────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
            <span style={{ color: color.textPrimary, fontSize: '15px', fontWeight: 700 }}>{title}</span>
            <span style={{
                color: color.textMuted, fontSize: '12px', fontWeight: 600,
                fontFamily: '"JetBrains Mono", monospace',
            }}>{count}</span>
        </div>
    )
}

// ─── DashboardView ──────────────────────────────────────────────────────────

export function DashboardView({ data }: { data: DashboardData }) {
    return (
        <div style={{ flex: 1, overflow: 'auto', background: color.bgCanvas }}>
            <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 28px 40px' }}>

                {/* ── Header ── */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '24px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: color.textPrimary, fontSize: '22px', fontWeight: 700, lineHeight: 1.2 }}>
                            {data.workspaceName}
                        </div>
                        <div style={{ color: color.textMuted, fontSize: '13px', marginTop: '4px' }}>
                            {data.agentCount} agents working across {data.projectCount} projects.
                        </div>
                    </div>
                    <span style={{
                        display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginTop: '2px',
                    }}>
                        <DotsIndicator />
                        <span style={{
                            color: color.warning, fontSize: '11px',
                            fontFamily: '"JetBrains Mono", monospace',
                        }}>running</span>
                    </span>
                </div>

                {/* ── Stat cards ── */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '28px' }}>
                    <StatCard label="Projects" value={data.stats.projects} dot={color.accent} />
                    <StatCard label="Active" value={data.stats.active} dot={color.success} />
                    <StatCard label="Waiting" value={data.stats.waiting} dot={color.warningBright} />
                    <StatCard label="Queued" value={data.stats.queued} dot={color.textGhost} />
                </div>

                {/* ── Working now ── */}
                <div style={{ marginBottom: '32px' }}>
                    <SectionHeader title="Working now" count={data.workingNow.length} />
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '12px',
                    }}>
                        {data.workingNow.map(agent => (
                            <WorkingAgentCard key={agent.id} agent={agent} />
                        ))}
                    </div>
                </div>

                {/* ── Projects ── */}
                <div>
                    <SectionHeader title="Projects" count={data.projects.length} />
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                        gap: '12px',
                    }}>
                        {data.projects.map(project => (
                            <ProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                </div>

            </div>
        </div>
    )
}
