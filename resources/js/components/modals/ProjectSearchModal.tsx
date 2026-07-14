import { useState, useEffect, useRef } from 'react'
import { Folder, Search, X } from 'lucide-react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { inputClass } from '@/components/ui/styles'

export function ProjectSearchModal({ projects, onClose, onSelect }: {
    projects: Project[]
    onClose: () => void
    onSelect: (project: Project) => void
}) {
    const [query, setQuery] = useState('')
    const [cursor, setCursor] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    const filtered = query.trim()
        ? projects.filter(p =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.path.toLowerCase().includes(query.toLowerCase())
        )
        : projects

    useEffect(() => { setCursor(0) }, [query])
    useEffect(() => { inputRef.current?.focus() }, [])

    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLDivElement>(`[data-idx="${cursor}"]`)
        el?.scrollIntoView({ block: 'nearest' })
    }, [cursor])

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
        else if (e.key === 'Enter') { e.preventDefault(); if (filtered[cursor]) { onSelect(filtered[cursor]); onClose() } }
        else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-start justify-center z-[500] pt-[15vh]"
            onClick={onClose}
        >
            <div
                className="bg-modal border border-stroke rounded-[10px] w-[480px] max-w-[92vw] shadow-[0_16px_48px_rgba(0,0,0,0.14)] overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Search input */}
                <div className="flex items-center gap-2.5 py-3 px-3.5 border-b border-stroke">
                    <Search size={14} color={color.textMuted} className="shrink-0"/>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Search projects..."
                        className={`${inputClass} flex-1`}
                        style={{ border: 'none', background: 'transparent', outline: 'none', padding: 0, fontSize: '14px' }}
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="bg-transparent border-0 text-zinc-500 cursor-pointer p-0.5 flex items-center">
                            <X size={12}/>
                        </button>
                    )}
                </div>

                {/* Results */}
                <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1 px-0">
                    {filtered.length === 0 ? (
                        <div className="p-5 text-center text-zinc-400 text-[13px]">No projects found</div>
                    ) : filtered.map((project, idx) => (
                        <div
                            key={project.id}
                            data-idx={idx}
                            onClick={() => { onSelect(project); onClose() }}
                            onMouseEnter={() => setCursor(idx)}
                            className={`flex items-center gap-2.5 py-2 px-3.5 cursor-pointer transition-colors duration-100 ${idx === cursor ? 'bg-canvas' : 'bg-transparent'}`}
                        >
                            <Folder size={13} color={color.textMuted} className="shrink-0"/>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium text-zinc-900 truncate">
                                    {project.name}
                                </div>
                                <div className="text-[11px] text-zinc-400 truncate font-mono">
                                    {project.path}
                                </div>
                            </div>
                            {idx === cursor && (
                                <span className="text-[10px] text-zinc-400 shrink-0">↵</span>
                            )}
                        </div>
                    ))}
                </div>

                {/* Footer hint */}
                <div className="border-t border-stroke py-1.5 px-3.5 flex gap-3">
                    {[['↑↓', 'navigate'], ['↵', 'open'], ['Esc', 'close']].map(([key, label]) => (
                        <span key={key} className="flex items-center gap-1 text-[11px] text-zinc-400">
                            <kbd className="bg-canvas border border-stroke rounded-[3px] py-px px-1 text-[10px] font-[inherit]">{key}</kbd>
                            {label}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    )
}
