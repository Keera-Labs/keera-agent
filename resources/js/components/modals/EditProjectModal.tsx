import { useState } from 'react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { ProjectTemplatesModal } from '@/components/modals/ProjectTemplatesModal'

// Light modal palette
const M = {
    bg:        '#ffffff',
    border:    '#d0d7de',
    inputBg:   '#f6f8fa',
    inputText: '#1f2328',
    heading:   '#1f2328',
    body:      '#57606a',
    faint:     '#6e7781',
}

export function EditProjectModal({
    project,
    onClose,
    onUpdated,
}: {
    project: Project
    onClose: () => void
    onUpdated: (p: Project) => void
}) {
    const [path,   setPath]   = useState(project.path)
    const [saving, setSaving] = useState(false)
    const [saved,  setSaved]  = useState(false)
    const [error,  setError]  = useState('')
    const [showTemplates, setShowTemplates] = useState(false)

    async function saveAll(e: React.FormEvent) {
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
            setTimeout(() => { setSaved(false); onClose() }, 1200)
        } catch { setError('Network error') } finally { setSaving(false) }
    }

    // ── Shared sub-styles ─────────────────────────────────────────────────────

    const inputSty: React.CSSProperties = {
        background: M.inputBg, border: `1px solid ${M.border}`, borderRadius: '6px',
        color: M.inputText, fontSize: '13px', padding: '7px 10px',
        outline: 'none', width: '100%', boxSizing: 'border-box',
    }

    const labelSty: React.CSSProperties = {
        color: M.body, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
    }

    const cancelSty: React.CSSProperties = {
        background: M.bg, border: `1px solid ${M.border}`, borderRadius: '6px',
        color: M.body, fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
    }

    const saveBtnSty: React.CSSProperties = {
        background: saved ? '#1a7f37' : color.accent,
        border: 'none', borderRadius: '6px', color: '#fff',
        fontSize: '12px', fontWeight: 600, padding: '6px 14px',
        cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
        transition: 'background 0.2s',
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: color.overlay,
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: M.bg, border: `1px solid ${M.border}`, borderRadius: '10px',
                    width: '520px', display: 'flex', flexDirection: 'column',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                    overflow: 'hidden',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* ── Modal header ── */}
                <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${M.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div>
                            <h2 style={{ margin: 0, color: M.heading, fontSize: '15px', fontWeight: 700 }}>
                                Edit project
                            </h2>
                            <p style={{ margin: '3px 0 0', color: color.accent, fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>
                                {project.name}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                color: M.body, padding: '4px', display: 'flex',
                                alignItems: 'center', borderRadius: '4px',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.color = M.heading)}
                            onMouseLeave={e => (e.currentTarget.style.color = M.body)}
                        >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
                            </svg>
                        </button>
                    </div>
                </div>

                {/* ── Form ── */}
                <form
                    onSubmit={saveAll}
                    style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}
                >
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

                    <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <p style={{ margin: 0, color: M.faint, fontSize: '12px', lineHeight: '1.5' }}>
                            Local filesystem path. Claude Code will run from this directory.
                        </p>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={labelSty}>Path</span>
                            <input
                                value={path}
                                onChange={e => setPath(e.target.value)}
                                placeholder="~/code/my-project"
                                required
                                style={{ ...inputSty, fontFamily: '"JetBrains Mono", monospace' }}
                            />
                        </label>
                    </section>

                    <section style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: `1px solid ${M.border}`, paddingTop: '16px' }}>
                        <span style={labelSty}>Agent templates</span>
                        <p style={{ margin: 0, color: M.faint, fontSize: '12px', lineHeight: '1.5' }}>
                            Customise templates for this project. Edits are copy-on-write — they create
                            project overrides and never change the global defaults.
                        </p>
                        <button
                            type="button"
                            onClick={() => setShowTemplates(true)}
                            style={{ ...cancelSty, alignSelf: 'flex-start' }}
                        >
                            Manage agent templates
                        </button>
                    </section>

                    {/* ── Actions ── */}
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
                        <button type="button" onClick={onClose} style={cancelSty}>Cancel</button>
                        <button type="submit" disabled={saving} style={saveBtnSty}>
                            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>

            {showTemplates && (
                <ProjectTemplatesModal
                    projectId={project.id}
                    projectName={project.name}
                    onClose={() => setShowTemplates(false)}
                />
            )}
        </div>
    )
}
