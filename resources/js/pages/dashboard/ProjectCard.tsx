import { router } from '@inertiajs/react'
import { avatarColor, FolderIcon, projectStatusSummary } from './helpers'
import type { DashboardProject } from './types'

export function ProjectCard({ project }: { project: DashboardProject }) {
    const summary = projectStatusSummary(project)
    return (
        <button
            type="button"
            onClick={() => router.visit(`/${project.slug}`)}
            title={`Open ${project.name}`}
            className="text-left cursor-pointer w-full bg-surface border border-stroke rounded-md p-[14px] flex flex-col gap-3 hover:border-accent"
            style={{ font: 'inherit' }}
        >
            <div className="flex items-center gap-2">
                <FolderIcon />
                <span className="flex-1 min-w-0 text-zinc-900 text-[13px] font-semibold truncate">{project.name}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${project.online ? 'bg-success' : 'bg-zinc-400'}`} />
            </div>

            {project.agents.length > 0 && (
                <div className="flex items-center gap-1">
                    {project.agents.map((a, i) => (
                        <span
                            key={i}
                            className="w-6 h-6 rounded shrink-0 text-white text-[10px] font-bold flex items-center justify-center font-mono"
                            style={{ background: avatarColor(a.agentType, a.initials) }}
                        >{a.initials}</span>
                    ))}
                    {project.extraAgents > 0 ? (
                        <span className="w-6 h-6 rounded shrink-0 bg-canvas border border-stroke text-zinc-500 text-[10px] font-bold flex items-center justify-center font-mono">+{project.extraAgents}</span>
                    ) : null}
                </div>
            )}

            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 font-mono">
                <span className="truncate">
                    {summary}
                </span>
                <span className="shrink-0">{project.lastActivity}</span>
            </div>
        </button>
    )
}
