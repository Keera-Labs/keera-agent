import { useState, useEffect, useRef } from 'react'
import { router } from '@inertiajs/react'
import { Folder, MoreVertical, Settings, ArrowRight, Trash2 } from 'lucide-react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { ProjectEditModal } from '@/pages/project/ProjectEditModal'
import { ProjectMoveModal } from '@/pages/project/ProjectMoveModal'
import { ProjectDeleteModal } from '@/pages/project/ProjectDeleteModal'

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

export function ProjectItem({ project, active, status }: {
    project: Project; active: boolean; status?: 'running' | 'done';
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

    // Close the popover menu once a triggered modal finishes (opens or closes).
    const closeMenu = (open: boolean) => { if (!open) setMenuOpen(false) }

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false) }}
            style={{ position: 'relative', display: 'flex', padding: '1px 6px' }}
        >
            <div
                role="button"
                tabIndex={0}
                onClick={() => router.visit(`/${project.slug}`)}
                onKeyDown={e => e.key === 'Enter' && router.visit(`/${project.slug}`)}
                style={{
                    flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '7px',
                    padding: '6px 28px 6px 8px',
                    background: active ? '#EEF2FF' : hovered ? '#F5F7FF' : 'transparent',
                    borderRadius: '6px',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.1s',
                }}
            >
                {/* Folder icon */}
                <Folder size={14} color={active ? '#4F46E5' : color.textMuted} style={{ flexShrink: 0 }}/>

                <span style={{
                    color: active ? '#4338CA' : color.textSecondary, fontSize: '13px',
                    fontWeight: active ? 600 : 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1,
                }}>
                    {project.name}
                </span>

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
                    <MoreVertical size={12}/>
                </button>
            )}

            {menuOpen && (
                <div ref={menuRef} style={{
                    position: 'absolute', right: '0', top: '100%', zIndex: 200,
                    background: color.bgSurface, border: `1px solid ${color.borderMuted}`,
                    borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    minWidth: '170px', padding: '4px 0',
                }}>
                    <ProjectEditModal
                        project={project}
                        onOpenChange={closeMenu}
                        trigger={
                            <button
                                type="button"
                                style={menuItemStyle()}
                                onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                                <Settings size={12} style={{ flexShrink: 0 }}/>
                                Edit project
                            </button>
                        }
                    />
                    <ProjectMoveModal
                        project={project}
                        onOpenChange={closeMenu}
                        trigger={
                            <button
                                type="button"
                                style={menuItemStyle()}
                                onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                                <ArrowRight size={12} style={{ flexShrink: 0 }}/>
                                Move to workspace
                            </button>
                        }
                    />
                    <button
                        type="button"
                        style={menuItemStyle()}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); fetch(`/api/projects/${project.id}/open-directory`, { method: 'POST' }) }}
                    >
                        <Folder size={12} style={{ flexShrink: 0 }}/>
                        Open in directory
                    </button>
                    <div style={{ height: '1px', background: color.border, margin: '4px 0' }} />
                    <ProjectDeleteModal
                        project={project}
                        onOpenChange={closeMenu}
                        trigger={
                            <button
                                type="button"
                                style={menuItemStyle(true)}
                                onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                                <Trash2 size={12} style={{ flexShrink: 0 }}/>
                                Delete project
                            </button>
                        }
                    />
                </div>
            )}
        </div>
    )
}
