export function SectionHeader({ title, count }: { title: string; count: number }) {
    return (
        <div className="flex items-baseline gap-2 mb-3">
            <span className="text-zinc-900 text-[15px] font-bold">{title}</span>
            <span className="text-zinc-500 text-[12px] font-semibold font-mono">{count}</span>
        </div>
    )
}
