import { useState, useEffect, useRef } from 'react'
import { router } from '@inertiajs/react'
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
                <svg
                    width="14" height="14" viewBox="0 0 16 16"
                    fill={active ? '#4F46E5' : color.textMuted}
                    style={{ flexShrink: 0 }}
                >
                    <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5L6.066 1.566A.25.25 0 005.89 1.5H1.75zm0 1.5h3.89l1.433 1.434a.25.25 0 00.177.066H14.25a.25.25 0 01.25.25v8.5a.25.25 0 01-.25.25H1.75a.25.25 0 01-.25-.25V2.75a.25.25 0 01.25-.25z"/>
                </svg>

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
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                                    <path d="M8 0a8.2 8.2 0 01.701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.087.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 01-.704 1.217c-.428.61-1.176.807-1.82.63l-1.103-.303c-.066-.019-.176-.011-.299.071a5.909 5.909 0 01-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 01-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 01-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 01-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 010-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 01.704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071a5.659 5.659 0 01.668-.386c.133-.066.194-.158.211-.224l.29-1.106C6.156.421 6.703-.129 7.445.031 7.645.015 7.825 0 8 0zm1.5 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                                </svg>
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
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                                    <path d="M7.47 1.97a.75.75 0 011.06 0l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 11-1.06-1.06L11.44 7H3a.75.75 0 010-1.5h8.44L7.47 3.03a.75.75 0 010-1.06z"/>
                                </svg>
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
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                            <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5L6.066 1.566A.25.25 0 005.89 1.5H1.75zm0 1.5h3.89l1.433 1.434a.25.25 0 00.177.066H14.25a.25.25 0 01.25.25v8.5a.25.25 0 01-.25.25H1.75a.25.25 0 01-.25-.25V2.75a.25.25 0 01.25-.25z"/>
                        </svg>
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
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                                    <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 00.249.225h5.19a.25.25 0 00.249-.225l.66-6.6a.75.75 0 011.492.149l-.66 6.6A1.748 1.748 0 0111.095 15H4.905a1.748 1.748 0 01-1.741-1.576l-.66-6.6a.75.75 0 111.492-.149z"/>
                                </svg>
                                Delete project
                            </button>
                        }
                    />
                </div>
            )}
        </div>
    )
}
