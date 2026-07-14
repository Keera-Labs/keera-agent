import { color } from '@/tokens'
import { DotsIndicator } from '@/layouts/sidebar/Project'
import { StatCard } from './StatCard'
import { WorkingAgentCard } from './WorkingAgentCard'
import { ProjectCard } from './ProjectCard'
import { SectionHeader } from './SectionHeader'
import type { DashboardData } from './types'

export function DashboardBody({ data }: { data: DashboardData }) {
    return (
        <div className="flex-1 overflow-auto bg-canvas">
            <div className="max-w-[1200px] mx-auto pt-6 px-7 pb-10">

                {/* ── Header ── */}
                <div className="flex items-start gap-3 mb-6">
                    <div className="flex-1 min-w-0">
                        <div className="text-zinc-900 text-[22px] font-bold leading-[1.2]">
                            {data.workspaceName}
                        </div>
                        <div className="text-zinc-500 text-[13px] mt-1">
                            {data.agentCount} agents working across {data.projectCount} projects.
                        </div>
                    </div>
                    <span className="flex items-center gap-1.5 shrink-0 mt-0.5">
                        <DotsIndicator />
                        <span className="text-amber-700 text-[11px] font-mono">running</span>
                    </span>
                </div>

                {/* ── Stat cards ── */}
                <div className="flex gap-3 mb-7">
                    <StatCard label="Projects" value={data.stats.projects} dot={color.accent} />
                    <StatCard label="Active" value={data.stats.active} dot={color.success} />
                    <StatCard label="Waiting" value={data.stats.waiting} dot={color.warningBright} />
                    <StatCard label="Queued" value={data.stats.queued} dot={color.textGhost} />
                </div>

                {/* ── Working now ── */}
                {data.workingNow.length > 0 && (
                    <div className="mb-8">
                        <SectionHeader title="Working now" count={data.workingNow.length} />
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                            {data.workingNow.map(agent => (
                                <WorkingAgentCard key={agent.id} agent={agent} />
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Projects ── */}
                <div>
                    <SectionHeader title="Projects" count={data.projects.length} />
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                        {data.projects.map(project => (
                            <ProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                </div>

            </div>
        </div>
    )
}
