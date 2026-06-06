import { useState, useEffect, useRef } from 'react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { inputStyle } from '@/components/ui/styles'

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
            style={{ position: 'fixed', inset: 0, background: color.overlay, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 500, paddingTop: '15vh' }}
            onClick={onClose}
        >
            <div
                style={{ background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '10px', width: '480px', maxWidth: '92vw', boxShadow: '0 16px 48px rgba(0,0,0,0.14)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Search input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderBottom: `1px solid ${color.border}` }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill={color.textMuted} style={{ flexShrink: 0 }}>
                        <path d="M10.68 11.74a6 6 0 01-7.922-8.982 6 6 0 018.982 7.922l3.04 3.04a.749.749 0 11-1.06 1.06l-3.04-3.04zm-5.68.26a4.5 4.5 0 100-9 4.5 4.5 0 000 9z"/>
                    </svg>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Search projects..."
                        style={{ ...inputStyle, flex: 1, border: 'none', background: 'transparent', outline: 'none', padding: 0, fontSize: '14px' }}
                    />
                    {query && (
                        <button onClick={() => setQuery('')} style={{ background: 'transparent', border: 'none', color: color.textMuted, cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}>
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>
                        </button>
                    )}
                </div>

                {/* Results */}
                <div ref={listRef} style={{ maxHeight: '320px', overflowY: 'auto', padding: '4px 0' }}>
                    {filtered.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: color.textFaint, fontSize: '13px' }}>No projects found</div>
                    ) : filtered.map((project, idx) => (
                        <div
                            key={project.id}
                            data-idx={idx}
                            onClick={() => { onSelect(project); onClose() }}
                            onMouseEnter={() => setCursor(idx)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '8px 14px', cursor: 'pointer',
                                background: idx === cursor ? color.bgBase : 'transparent',
                                transition: 'background 0.1s',
                            }}
                        >
                            <svg width="13" height="13" viewBox="0 0 16 16" fill={color.textMuted} style={{ flexShrink: 0 }}>
                                <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5L6.066 1.566A.25.25 0 005.89 1.5H1.75zm0 1.5h3.89l1.433 1.434a.25.25 0 00.177.066H14.25a.25.25 0 01.25.25v8.5a.25.25 0 01-.25.25H1.75a.25.25 0 01-.25-.25V2.75a.25.25 0 01.25-.25z"/>
                            </svg>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '13px', fontWeight: 500, color: color.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {project.name}
                                </div>
                                <div style={{ fontSize: '11px', color: color.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"JetBrains Mono", monospace' }}>
                                    {project.path}
                                </div>
                            </div>
                            {idx === cursor && (
                                <span style={{ fontSize: '10px', color: color.textFaint, flexShrink: 0 }}>↵</span>
                            )}
                        </div>
                    ))}
                </div>

                {/* Footer hint */}
                <div style={{ borderTop: `1px solid ${color.border}`, padding: '6px 14px', display: 'flex', gap: '12px' }}>
                    {[['↑↓', 'navigate'], ['↵', 'open'], ['Esc', 'close']].map(([key, label]) => (
                        <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: color.textFaint }}>
                            <kbd style={{ background: color.bgBase, border: `1px solid ${color.border}`, borderRadius: '3px', padding: '1px 4px', fontSize: '10px', fontFamily: 'inherit' }}>{key}</kbd>
                            {label}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    )
}
