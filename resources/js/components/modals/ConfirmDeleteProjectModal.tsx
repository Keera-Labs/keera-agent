import { useState } from 'react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { cancelBtnStyle } from '@/components/ui/styles'

export function ConfirmDeleteProjectModal({
    project,
    onClose,
    onDeleted,
}: {
    project: Project
    onClose: () => void
    onDeleted: (projectId: number) => void
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    async function handleDelete() {
        setLoading(true)
        setError('')
        try {
            const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                setError(data.error ?? 'Failed to delete project')
                return
            }
            onDeleted(project.id)
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '320px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>Delete Project</h2>
                <p style={{ margin: 0, color: color.textMuted, fontSize: '13px', lineHeight: 1.5 }}>
                    Remove{' '}
                    <span style={{ color: color.textSecondary, fontFamily: '"JetBrains Mono", monospace', fontSize: '12px' }}>{project.name}</span>
                    {' '}from Keera? This only removes it from the app — files on disk are not deleted.
                </p>
                {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={onClose} disabled={loading} style={cancelBtnStyle}>Cancel</button>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={handleDelete}
                        style={{
                            background: '#da3633', border: `1px solid ${color.danger}`,
                            borderRadius: '6px', color: '#fff', fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
                        }}
                    >
                        {loading ? 'Deleting…' : 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    )
}
