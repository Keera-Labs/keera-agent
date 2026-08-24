import { useEffect, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { useAgentCheckin } from '@/queries/agentCheckinQuery'

/**
 * Start/stop toggle + interval input for the PM check-in scheduler. Used for
 * the PM agent only — as a full block on the overview card, or via `compact`
 * inline in the agent detail header. The scheduler pings the PM every N
 * minutes while a task is in_progress and auto-stops once none remain.
 */
export function PmCheckinControl({ agentId, compact = false }: { agentId: number; compact?: boolean }) {
    const { checkin, update } = useAgentCheckin(agentId)
    const [minutes, setMinutes] = useState(5)

    // Sync the local input to the server value whenever it changes (initial
    // load, auto-stop, or another tab toggling it).
    useEffect(() => {
        if (checkin) setMinutes(checkin.interval_minutes)
    }, [checkin?.interval_minutes])

    const running = checkin?.running ?? false

    const toggle = () => {
        const next = !running
        update.mutate({ enabled: next, interval_minutes: Math.max(1, minutes) })
    }

    // Compact: single-row rendering for the agent detail header, where the
    // control must sit inline with the other header chrome instead of taking
    // a full card-width block.
    if (compact) {
        return (
            <div className="flex items-center gap-1.5">
                <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: running ? '#16a34a' : '#d4d4d8' }}
                    title={running ? 'Check-in running' : 'Check-in stopped'}
                />
                <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                    Every
                    <input
                        type="number"
                        min={1}
                        max={1440}
                        value={minutes}
                        disabled={running}
                        onChange={e => setMinutes(Number(e.target.value))}
                        className="w-10 border border-stroke rounded py-0.5 px-1 text-[11px] text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-400"
                    />
                    min
                </label>
                <button
                    type="button"
                    onClick={toggle}
                    disabled={update.isPending}
                    title={running ? 'Stop PM check-in' : 'Start PM check-in'}
                    className={`inline-flex items-center gap-1 rounded-md py-1 px-2 text-[11px] font-semibold border cursor-pointer transition-opacity duration-100 hover:opacity-[0.85] disabled:opacity-50 ${
                        running
                            ? 'bg-transparent border-stroke text-zinc-700'
                            : 'bg-[#111318] border-transparent text-white'
                    }`}
                >
                    {running ? <Square size={11} /> : <Play size={11} />}
                    {running ? 'Stop' : 'Start'}
                </button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-zinc-400">
                    PM Check-in
                </span>
                <span
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                    style={{ color: running ? '#16a34a' : '#a1a1aa' }}
                >
                    <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: running ? '#16a34a' : '#d4d4d8' }}
                    />
                    {running ? 'Running' : 'Stopped'}
                </span>
            </div>

            <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[12.5px] text-zinc-600">
                    Every
                    <input
                        type="number"
                        min={1}
                        max={1440}
                        value={minutes}
                        disabled={running}
                        onChange={e => setMinutes(Number(e.target.value))}
                        className="w-14 border border-stroke rounded-md py-1 px-2 text-[12.5px] text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-400"
                    />
                    min
                </label>

                <button
                    type="button"
                    onClick={toggle}
                    disabled={update.isPending}
                    className={`ml-auto inline-flex items-center gap-1.5 rounded-md py-1.5 px-3 text-[12.5px] font-semibold border cursor-pointer transition-opacity duration-100 hover:opacity-[0.85] disabled:opacity-50 ${
                        running
                            ? 'bg-transparent border-stroke text-zinc-700'
                            : 'bg-[#111318] border-transparent text-white'
                    }`}
                >
                    {running ? <Square size={12} /> : <Play size={12} />}
                    {running ? 'Stop' : 'Start'}
                </button>
            </div>
        </div>
    )
}
