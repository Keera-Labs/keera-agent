import { color } from '@/tokens'
import { DotsIndicator } from '@/layouts/sidebar/Project'
import { StatCard } from './StatCard'
import { WorkingAgentCard } from './WorkingAgentCard'
import { ProjectCard } from './ProjectCard'
import { SectionHeader } from './SectionHeader'
import type { DashboardData } from './types'

export function DashboardBody({ data }: { data: DashboardData }) {
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
                {data.workingNow.length > 0 && (
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
                )}

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
