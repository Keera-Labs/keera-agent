// ─── Shared Tailwind class strings ────────────────────────────────────────────

export const labelClass = 'text-zinc-500 text-[11px] uppercase tracking-[0.05em]'

export const inputClass =
    'bg-canvas border border-stroke rounded text-zinc-900 text-[13px] px-2.5 py-1.5 font-mono outline-none'

export const cancelBtnClass =
    'bg-transparent border border-stroke rounded text-zinc-500 text-[12px] px-3.5 py-1.5 cursor-pointer'

export const submitBtnClass =
    'bg-success border border-success rounded text-white text-[12px] px-3.5 py-1.5 cursor-pointer'

export const flagRowClass =
    'flex items-center justify-between px-2.5 py-1.5 rounded bg-canvas border border-stroke cursor-pointer'

export const toggleClass = (on: boolean) =>
    `w-8 h-[18px] rounded-[9px] ${on ? 'bg-accent' : 'bg-stroke'} border-0 cursor-pointer relative shrink-0 transition-colors duration-150`
