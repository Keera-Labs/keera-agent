import { useState } from 'react'
import { useForm } from '@inertiajs/react'
import { color } from '@/tokens'
import type { Workspace, Project } from '@/types/type'

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']

const labelStyle: React.CSSProperties = { color: color.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle: React.CSSProperties = {
    background: color.bgBase, border: `1px solid ${color.borderMuted}`, borderRadius: '6px',
    color: color.textPrimary, fontSize: '13px', padding: '6px 10px',
    fontFamily: '"JetBrains Mono", monospace', outline: 'none',
}
const cancelBtnStyle: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${color.borderMuted}`, borderRadius: '6px',
    color: color.textMuted, fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
}
const submitBtnStyle: React.CSSProperties = {
    background: color.successEmphasis, border: `1px solid ${color.successBorder}`, borderRadius: '6px',
    color: '#fff', fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
}

export default function ProjectCreateModal({
    workspaces,
    defaultWorkspaceId,
    onClose,
    onCreated,
}: {
    workspaces: Workspace[]
    defaultWorkspaceId: number | null
    onClose: () => void
    onCreated: (p: Project) => void
}) {
    const form = useForm({
        name: '',
        path: '',
        language: 'Python',
        workspace_id: (defaultWorkspaceId ?? workspaces[0]?.id ?? null) as number | null,
        create_dir: false,
    })
    const [error, setError] = useState('')
    const [confirmCreate, setConfirmCreate] = useState<{ expanded: string } | null>(null)

    function submit(createDir = false) {
        setError('')
        form.transform(data => ({ ...data, create_dir: createDir }))
        form.post('/api/projects', {
            onSuccess: (page: { props: Record<string, unknown> }) => {
                onCreated(page.props.new_project as Project)
                onClose()
            },
            onError: (errors: Record<string, string>) => {
                if (errors.path_not_found) {
                    setConfirmCreate({ expanded: errors.path_not_found })
                    return
                }
                setConfirmCreate(null)
                setError(errors._ ?? 'Something went wrong')
            },
        })
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgSurface, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '340px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                {confirmCreate ? (
                    <>
                        <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>Directory not found</h2>
                        <p style={{ margin: 0, color: color.textMuted, fontSize: '13px', lineHeight: 1.5 }}>
                            <span style={{ color: color.textSecondary, fontFamily: '"JetBrains Mono", monospace', fontSize: '12px' }}>{confirmCreate.expanded}</span>
                            {' '}does not exist. Create it?
                        </p>
                        {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setConfirmCreate(null)} style={cancelBtnStyle}>Back</button>
                            <button type="button" disabled={form.processing} onClick={() => submit(true)} style={submitBtnStyle}>
                                {form.processing ? 'Creating…' : 'Create & Add'}
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={e => { e.preventDefault(); submit() }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>New Project</h2>
                        {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Workspace</span>
                            <select
                                value={form.data.workspace_id ?? ''}
                                onChange={e => form.setData('workspace_id', e.target.value ? Number(e.target.value) : null)}
                                style={inputStyle}
                            >
                                <option value="">— No workspace —</option>
                                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Name</span>
                            <input value={form.data.name} onChange={e => form.setData('name', e.target.value)} placeholder="my-project" required style={inputStyle} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Path</span>
                            <input value={form.data.path} onChange={e => form.setData('path', e.target.value)} placeholder="~/code/my-project" required style={inputStyle} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Language</span>
                            <select value={form.data.language} onChange={e => form.setData('language', e.target.value)} style={inputStyle}>
                                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </label>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                            <button type="submit" disabled={form.processing} style={submitBtnStyle}>
                                {form.processing ? 'Checking…' : 'Add Project'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}
