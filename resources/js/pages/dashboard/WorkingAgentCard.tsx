import { color } from '@/tokens'
import { avatarColor, FolderIcon } from './helpers'
import type { DashboardWorkingAgent } from './types'

export function WorkingAgentCard({ agent }: { agent: DashboardWorkingAgent }) {
    const bg = avatarColor(agent.agentType, agent.name)
    return (
        <div className="bg-surface border border-stroke rounded-md p-[14px] flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
                <span
                    className="w-[34px] h-[34px] rounded-md shrink-0 text-white text-[12px] font-bold flex items-center justify-center font-mono"
                    style={{ background: bg }}
                >{agent.initials}</span>
                <div className="flex-1 min-w-0">
                    <div className="text-zinc-900 text-[13px] font-semibold truncate">{agent.name}</div>
                    <div className="text-zinc-500 text-[11px] truncate">{agent.role}</div>
                </div>
                <span className="flex items-center gap-1 shrink-0 text-[10px] font-semibold py-0.5 px-2 rounded-lg bg-[rgba(63,185,80,0.1)] border border-[rgba(63,185,80,0.3)] text-success">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    Active
                </span>
            </div>
            <div className="text-zinc-700 text-[12px] leading-normal">
                {agent.description}
            </div>
            <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] font-mono">
                <FolderIcon size={11} fill={color.textFaint} />
                <span className="truncate">
                    {agent.project}
                </span>
                <span>·</span>
                <span>{agent.elapsed}</span>
            </div>
        </div>
    )
}
