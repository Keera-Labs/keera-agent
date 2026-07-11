import { router } from '@inertiajs/react'
import { color } from '@/tokens'
import { avatarColor, FolderIcon, projectStatusSummary } from './helpers'
import type { DashboardProject } from './types'

export function ProjectCard({ project }: { project: DashboardProject }) {
    const summary = projectStatusSummary(project)
    return (
        <button
            type="button"
            onClick={() => router.visit(`/${project.slug}`)}
            title={`Open ${project.name}`}
            style={{
                textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%',
                background: color.bgSurface,
                border: `1px solid ${color.border}`,
                borderRadius: '8px',
                padding: '14px',
                display: 'flex', flexDirection: 'column', gap: '12px',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = color.accent }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = color.border }}
        >
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

            {project.agents.length > 0 && (
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
                    {project.extraAgents > 0 ? (
                        <span style={{
                            width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0,
                            background: color.bgCanvas, border: `1px solid ${color.border}`,
                            color: color.textMuted, fontSize: '10px', fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: '"JetBrains Mono", monospace',
                        }}>+{project.extraAgents}</span>
                    ) : null}
                </div>
            )}

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
        </button>
    )
}
