import { useState, type ReactNode } from 'react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import Modal from '@/components/ui/Modal'
import useProjects from '@/queries/useProjects'
import { ProjectTemplatesModal } from '@/components/modals/ProjectTemplatesModal'

const inputStyle: React.CSSProperties = {
    background: color.bgCanvas, border: `1px solid ${color.stroke}`, borderRadius: '6px',
    color: color.textPrimary, fontSize: '13px', padding: '7px 10px',
    outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: '"JetBrains Mono", monospace',
}
const labelStyle: React.CSSProperties = {
    color: color.textSecondary, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
}
const cancelStyle: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${color.stroke}`, borderRadius: '6px',
    color: color.textSecondary, fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
}

function EditProjectForm({
    project, onUpdated, close,
}: {
    project: Project
    onUpdated: (p: Project) => void
    close: () => void
}) {
    const [path, setPath] = useState(project.path)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState('')
    const [showTemplates, setShowTemplates] = useState(false)

    async function save(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true); setError('')
        try {
            const res = await fetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path.trim() }),
            })
            if (!res.ok) { setError('Something went wrong'); return }
            onUpdated(await res.json())
            setSaved(true)
            setTimeout(close, 1000)
        } catch { setError('Network error') } finally { setSaving(false) }
    }

    return (
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
                <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 700 }}>Edit project</h2>
                <p style={{ margin: '3px 0 0', color: color.accent, fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>
                    {project.name}
                </p>
            </div>

            {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={labelStyle}>Path</span>
                <span style={{ color: color.textMuted, fontSize: '12px', lineHeight: 1.5 }}>
                    Local filesystem path. Claude Code will run from this directory.
                </span>
                <input value={path} onChange={e => setPath(e.target.value)} placeholder="~/code/my-project" required style={inputStyle} />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: `1px solid ${color.stroke}`, paddingTop: '16px' }}>
                <span style={labelStyle}>Agent templates</span>
                <span style={{ color: color.textMuted, fontSize: '12px', lineHeight: 1.5 }}>
                    Customise templates for this project. Edits are copy-on-write — they create project overrides and never change the global defaults.
                </span>
                <button type="button" onClick={() => setShowTemplates(true)} style={{ ...cancelStyle, alignSelf: 'flex-start' }}>
                    Manage agent templates
                </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={close} style={cancelStyle}>Cancel</button>
                <button
                    type="submit" disabled={saving}
                    style={{
                        background: saved ? color.success : color.accent, border: 'none', borderRadius: '6px',
                        color: '#fff', fontSize: '12px', fontWeight: 600, padding: '6px 14px',
                        cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
                    }}
                >
                    {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
                </button>
            </div>

            {showTemplates && (
                <ProjectTemplatesModal projectId={project.id} projectName={project.name} onClose={() => setShowTemplates(false)} />
            )}
        </form>
    )
}

export function ProjectEditModal({
    project, trigger, onOpenChange,
}: {
    project: Project
    trigger: ReactNode
    onOpenChange?: (open: boolean) => void
}) {
    const { handleProjectUpdated } = useProjects()
    return (
        <Modal
            trigger={trigger}
            ariaLabel="Edit project"
            onOpenChange={onOpenChange}
            panelClassName="bg-modal border border-stroke rounded-lg p-6 w-[480px] flex flex-col"
        >
            {close => <EditProjectForm project={project} onUpdated={handleProjectUpdated} close={close} />}
        </Modal>
    )
}
