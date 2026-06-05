import { useState, useEffect, useRef } from 'react'
import { router } from '@inertiajs/react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'

const dotsStyle = `
@keyframes bounce1 { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
@keyframes bounce2 { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
@keyframes bounce3 { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
@keyframes traveler {
  0%   { left: 0px;   opacity: 0;   }
  10%  { opacity: 1;               }
  90%  { opacity: 1;               }
  100% { left: 18px;  opacity: 0;  }
}
`

export function DotsIndicator() {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0, position: 'relative' }}>
            <style>{dotsStyle}</style>
            <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#f59e0b', animation: 'bounce1 1.0s ease-in-out infinite 0.0s' }} />
            <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#f59e0b', animation: 'bounce2 1.0s ease-in-out infinite 0.15s' }} />
            <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#f59e0b', animation: 'bounce3 1.0s ease-in-out infinite 0.3s' }} />
            <span style={{
                position: 'absolute', top: '50%', marginTop: '-2px',
                width: '4px', height: '4px', borderRadius: '50%',
                background: '#d97706',
                boxShadow: '0 0 4px 1px rgba(217,119,6,0.4)',
                animation: 'traveler 1.0s linear infinite',
            }} />
        </span>
    )
}

export function ProjectItem({ project, active, status, onMove, onEdit, onSystemPrompt, onPermissions, onDelete }: {
    project: Project; active: boolean; status?: 'running' | 'done';
    onMove: (p: Project) => void;
    onEdit: (p: Project) => void;
    onSystemPrompt: (p: Project) => void;
    onPermissions: (p: Project) => void;
    onDelete: (p: Project) => void;
}) {
    const [hovered, setHovered] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!menuOpen) return
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [menuOpen])

    const menuItemStyle = (danger = false): React.CSSProperties => ({
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 12px', cursor: 'pointer', fontSize: '12px',
        color: danger ? color.danger : color.textSecondary,
        background: 'transparent', border: 'none', width: '100%', textAlign: 'left',
        whiteSpace: 'nowrap',
    })

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false) }}
            style={{ position: 'relative', display: 'flex' }}
        >
            <div
                role="button"
                tabIndex={0}
                onClick={() => router.visit(`/${project.slug}`)}
                onKeyDown={e => e.key === 'Enter' && router.visit(`/${project.slug}`)}
                style={{
                    flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '6px',
                    padding: '7px 32px 7px 12px', background: active ? color.bgSurface : 'transparent',
                    borderLeft: `2px solid ${active ? color.accent : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left',
                }}
            >
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <span style={{
                        color: active ? color.textPrimary : color.textSecondary, fontSize: '13px',
                        fontWeight: active ? 600 : 400, fontFamily: '"JetBrains Mono", monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {project.name}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: color.textMuted, fontSize: '11px' }}>•</span>
                        <span style={{ color: color.textMuted, fontSize: '11px', fontStyle: 'italic' }}>{project.language}</span>
                    </span>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    {status === 'running' && <DotsIndicator />}
                    {status === 'done' && (
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color.success }} />
                    )}
                </div>
            </div>

            {(hovered || menuOpen) && (
                <button
                    onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
                    style={{
                        position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                        background: menuOpen ? color.bgSurface : 'transparent',
                        border: menuOpen ? `1px solid ${color.borderMuted}` : '1px solid transparent',
                        borderRadius: '4px', cursor: 'pointer',
                        color: color.textMuted, padding: '2px 4px',
                        display: 'flex', alignItems: 'center', lineHeight: 1,
                    }}
                    onMouseEnter={e => { if (!menuOpen) e.currentTarget.style.background = color.bgSurface }}
                    onMouseLeave={e => { if (!menuOpen) e.currentTarget.style.background = 'transparent' }}
                >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0-5.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                    </svg>
                </button>
            )}

            {menuOpen && (
                <div ref={menuRef} style={{
                    position: 'absolute', right: '0', top: '100%', zIndex: 200,
                    background: color.bgSurface, border: `1px solid ${color.borderMuted}`,
                    borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    minWidth: '170px', padding: '4px 0', overflow: 'hidden',
                }}>
                    <button
                        style={menuItemStyle()}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(project) }}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                            <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064l6.286-6.286z"/>
                        </svg>
                        Change directory
                    </button>
                    <button
                        style={{ ...menuItemStyle(), color: project.system_prompt ? color.accent : color.textSecondary }}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); onSystemPrompt(project) }}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                            <path d="M0 1.75A.75.75 0 01.75 1h9.5a.75.75 0 010 1.5H.75A.75.75 0 010 1.75zM0 8a.75.75 0 01.75-.75h9.5a.75.75 0 010 1.5H.75A.75.75 0 010 8zm0 6.25a.75.75 0 01.75-.75h5.5a.75.75 0 010 1.5H.75a.75.75 0 01-.75-.75z"/>
                        </svg>
                        System instructions
                    </button>
                    <button
                        style={menuItemStyle()}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); onPermissions(project) }}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                            <path d="M8.533.133a1.75 1.75 0 00-1.066 0l-5.25 1.68A1.75 1.75 0 001 3.48V8c0 3.183 1.958 5.837 4.798 7.319a.75.75 0 00.404.119.75.75 0 00.404-.119C9.042 13.837 11 11.183 11 8V3.48a1.75 1.75 0 00-1.217-1.667L8.533.133zm-.61 1.429a.25.25 0 01.153 0l5.25 1.68a.25.25 0 01.174.238V8c0 2.67-1.625 4.91-4 6.282C7.875 12.91 6.25 10.67 6.25 8V3.48a.25.25 0 01.173-.238l1.5-.48z"/>
                        </svg>
                        Permissions
                    </button>
                    <button
                        style={menuItemStyle()}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); onMove(project) }}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                            <path d="M7.47 1.97a.75.75 0 011.06 0l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 11-1.06-1.06L11.44 7H3a.75.75 0 010-1.5h8.44L7.47 3.03a.75.75 0 010-1.06z"/>
                        </svg>
                        Move to workspace
                    </button>
                    <button
                        style={menuItemStyle()}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); fetch(`/api/projects/${project.id}/open-directory`, { method: 'POST' }) }}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                            <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5L6.066 1.566A.25.25 0 005.89 1.5H1.75zm0 1.5h3.89l1.433 1.434a.25.25 0 00.177.066H14.25a.25.25 0 01.25.25v8.5a.25.25 0 01-.25.25H1.75a.25.25 0 01-.25-.25V2.75a.25.25 0 01.25-.25z"/>
                        </svg>
                        Open in directory
                    </button>
                    <div style={{ height: '1px', background: color.border, margin: '4px 0' }} />
                    <button
                        style={menuItemStyle(true)}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(project) }}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                            <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 00.249.225h5.19a.25.25 0 00.249-.225l.66-6.6a.75.75 0 011.492.149l-.66 6.6A1.748 1.748 0 0111.095 15H4.905a1.748 1.748 0 01-1.741-1.576l-.66-6.6a.75.75 0 111.492-.149z"/>
                        </svg>
                        Delete project
                    </button>
                </div>
            )}
        </div>
    )
}
