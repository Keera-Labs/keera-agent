import { color } from '@/tokens'
import { avatarColor, FolderIcon } from './helpers'
import type { DashboardWorkingAgent } from './types'

export function WorkingAgentCard({ agent }: { agent: DashboardWorkingAgent }) {
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
