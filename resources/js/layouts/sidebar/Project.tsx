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
        <span className="inline-flex items-center gap-[3px] shrink-0 relative">
            <style>{dotsStyle}</style>
            <span className="w-[3px] h-[3px] rounded-full bg-[#f59e0b]" style={{ animation: 'bounce1 1.0s ease-in-out infinite 0.0s' }} />
            <span className="w-[3px] h-[3px] rounded-full bg-[#f59e0b]" style={{ animation: 'bounce2 1.0s ease-in-out infinite 0.15s' }} />
            <span className="w-[3px] h-[3px] rounded-full bg-[#f59e0b]" style={{ animation: 'bounce3 1.0s ease-in-out infinite 0.3s' }} />
            <span
                className="absolute top-1/2 -mt-0.5 w-1 h-1 rounded-full bg-[#d97706] shadow-[0_0_4px_1px_rgba(217,119,6,0.4)]"
                style={{ animation: 'traveler 1.0s linear infinite' }}
            />
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

    const menuItemClass = (danger = false): string =>
        `flex items-center gap-2 py-1.5 px-3 cursor-pointer text-[12px] ${danger ? 'text-danger' : 'text-zinc-700'} bg-transparent border-0 w-full text-left whitespace-nowrap hover:bg-canvas`

    // Close the popover menu once a triggered modal finishes (opens or closes).
    const closeMenu = (open: boolean) => { if (!open) setMenuOpen(false) }

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false) }}
            className="relative flex py-px px-1.5"
        >
            <div
                role="button"
                tabIndex={0}
                onClick={() => router.visit(`/${project.slug}`)}
                onKeyDown={e => e.key === 'Enter' && router.visit(`/${project.slug}`)}
                className={`flex-1 flex flex-row items-center gap-[7px] pt-1.5 pr-7 pb-1.5 pl-2 rounded cursor-pointer text-left transition-colors duration-100 ${active ? 'bg-[#EEF2FF]' : hovered ? 'bg-[#F5F7FF]' : 'bg-transparent'}`}
            >
                {/* Folder icon */}
                <Folder size={14} color={active ? '#4F46E5' : color.textMuted} className="shrink-0"/>

                <span className={`text-[13px] truncate flex-1 ${active ? 'text-[#4338CA] font-semibold' : 'text-zinc-700 font-normal'}`}>
                    {project.name}
                </span>

                <div className="shrink-0 flex items-center">
                    {status === 'running' && <DotsIndicator />}
                    {status === 'done' && (
                        <span className="w-[7px] h-[7px] rounded-full bg-success" />
                    )}
                </div>
            </div>

            {(hovered || menuOpen) && (
                <button
                    onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
                    className={`absolute right-1.5 top-1/2 -translate-y-1/2 border rounded-sm cursor-pointer text-zinc-500 py-0.5 px-1 flex items-center leading-none ${menuOpen ? 'bg-surface border-stroke' : 'bg-transparent border-transparent hover:bg-surface'}`}
                >
                    <MoreVertical size={12}/>
                </button>
            )}

            {menuOpen && (
                <div ref={menuRef} className="absolute right-0 top-full z-[200] bg-surface border border-stroke rounded shadow-[0_8px_24px_rgba(0,0,0,0.12)] min-w-[170px] py-1 px-0">
                    <ProjectEditModal
                        project={project}
                        onOpenChange={closeMenu}
                        trigger={
                            <button
                                type="button"
                                className={menuItemClass()}
                            >
                                <Settings size={12} className="shrink-0"/>
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
                                className={menuItemClass()}
                            >
                                <ArrowRight size={12} className="shrink-0"/>
                                Move to workspace
                            </button>
                        }
                    />
                    <button
                        type="button"
                        className={menuItemClass()}
                        onClick={e => { e.stopPropagation(); setMenuOpen(false); fetch(`/api/projects/${project.id}/open-directory`, { method: 'POST' }) }}
                    >
                        <Folder size={12} className="shrink-0"/>
                        Open in directory
                    </button>
                    <div className="h-px bg-stroke my-1 mx-0" />
                    <ProjectDeleteModal
                        project={project}
                        onOpenChange={closeMenu}
                        trigger={
                            <button
                                type="button"
                                className={menuItemClass(true)}
                            >
                                <Trash2 size={12} className="shrink-0"/>
                                Delete project
                            </button>
                        }
                    />
                </div>
            )}
        </div>
    )
}
