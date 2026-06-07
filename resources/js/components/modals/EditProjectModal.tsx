import { useState, useEffect } from 'react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { TagInput } from '@/components/ui/TagInput'

type Tab = 'general' | 'instructions' | 'permissions'

// Dark modal palette
const M = {
    bg:        '#1c1f26',
    border:    '#2a2f3a',
    inputBg:   '#0d1117',
    inputText: '#e2e6ed',
    heading:   '#f0f6fc',
    body:      '#8b949e',
    faint:     '#6e7681',
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
    const [tab, setTab] = useState<Tab>('general')

    // General tab
    const [path, setPath]               = useState(project.path)
    const [pathLoading, setPathLoading] = useState(false)
    const [pathError,   setPathError]   = useState('')
    const [pathSaved,   setPathSaved]   = useState(false)

    // System Instructions tab
    const [prompt,         setPrompt]         = useState(project.system_prompt ?? '')
    const [promptLoading,  setPromptLoading]  = useState(false)
    const [promptError,    setPromptError]    = useState('')
    const [promptSaved,    setPromptSaved]    = useState(false)

    // Permissions tab
    const [allow,        setAllow]        = useState<string[]>([])
    const [deny,         setDeny]         = useState<string[]>([])
    const [permFetching, setPermFetching] = useState(true)
    const [permSaving,   setPermSaving]   = useState(false)
    const [permError,    setPermError]    = useState('')
    const [permSaved,    setPermSaved]    = useState(false)

    useEffect(() => {
        fetch(`/api/projects/${project.id}/permissions`)
            .then(r => r.json())
            .then(d => { setAllow(d.allow ?? []); setDeny(d.deny ?? []) })
            .catch(() => setPermError('Failed to load permissions'))
            .finally(() => setPermFetching(false))
    }, [project.id])

    async function saveGeneral(e: React.FormEvent) {
        e.preventDefault()
        setPathError('')
        setPathLoading(true)
        try {
            const res = await fetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path.trim() }),
            })
            const data = await res.json()
            if (!res.ok) { setPathError(data.error ?? 'Something went wrong'); return }
            onUpdated(data as Project)
            setPathSaved(true)
            setTimeout(() => setPathSaved(false), 2500)
        } catch { setPathError('Network error') }
        finally { setPathLoading(false) }
    }

    async function saveInstructions(e: React.FormEvent) {
        e.preventDefault()
        setPromptError('')
        setPromptLoading(true)
        try {
            const res = await fetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ system_prompt: prompt.trim() || null }),
            })
            const data = await res.json()
            if (!res.ok) { setPromptError(data.error ?? 'Something went wrong'); return }
            onUpdated(data as Project)
            setPromptSaved(true)
            setTimeout(() => setPromptSaved(false), 2500)
        } catch { setPromptError('Network error') }
        finally { setPromptLoading(false) }
    }

    async function savePermissions(e: React.FormEvent) {
        e.preventDefault()
        setPermError('')
        setPermSaving(true)
        try {
            const res = await fetch(`/api/projects/${project.id}/permissions`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ allow, deny }),
            })
            const data = await res.json()
            if (!res.ok) { setPermError(data.error ?? 'Something went wrong'); return }
            setAllow(data.allow ?? [])
            setDeny(data.deny ?? [])
            setPermSaved(true)
            setTimeout(() => setPermSaved(false), 2500)
        } catch { setPermError('Network error') }
        finally { setPermSaving(false) }
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
        background: 'transparent', border: `1px solid ${M.border}`, borderRadius: '6px',
        color: M.body, fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
    }

    function saveSty(saving: boolean, saved: boolean): React.CSSProperties {
        return {
            background: saved ? '#238636' : color.accent,
            border: 'none', borderRadius: '6px', color: '#fff',
            fontSize: '12px', fontWeight: 600, padding: '6px 14px',
            cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
            transition: 'background 0.2s',
        }
    }

    function tabBtnSty(t: Tab): React.CSSProperties {
        const active = tab === t
        return {
            background: 'transparent', border: 'none',
            borderBottom: `2px solid ${active ? color.accent : 'transparent'}`,
            color: active ? M.heading : M.body,
            fontSize: '13px', fontWeight: active ? 600 : 400,
            padding: '8px 14px', cursor: 'pointer',
            transition: 'color 0.12s', marginBottom: '-1px',
        }
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
                    width: '520px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                    overflow: 'hidden',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* ── Modal header ── */}
                <div style={{ padding: '20px 24px 0', borderBottom: `1px solid ${M.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
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

                    {/* Tabs */}
                    <div style={{ display: 'flex', marginBottom: '-1px' }}>
                        {(['general', 'instructions', 'permissions'] as Tab[]).map(t => (
                            <button key={t} style={tabBtnSty(t)} onClick={() => setTab(t)}>
                                {t === 'general' ? 'General' : t === 'instructions' ? 'System Instructions' : 'Permissions'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── Tab content ── */}
                <div style={{ padding: '20px 24px 24px', overflowY: 'auto', flex: 1 }}>

                    {/* ── GENERAL ── */}
                    {tab === 'general' && (
                        <form onSubmit={saveGeneral} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <p style={{ margin: 0, color: M.faint, fontSize: '12px', lineHeight: '1.5' }}>
                                Local filesystem path. Claude Code will run from this directory.
                            </p>
                            {pathError && <span style={{ color: color.danger, fontSize: '12px' }}>{pathError}</span>}
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
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={onClose} style={cancelSty}>Cancel</button>
                                <button type="submit" disabled={pathLoading} style={saveSty(pathLoading, pathSaved)}>
                                    {pathSaved ? '✓ Saved' : pathLoading ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* ── SYSTEM INSTRUCTIONS ── */}
                    {tab === 'instructions' && (
                        <form onSubmit={saveInstructions} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <p style={{ margin: 0, color: M.faint, fontSize: '12px', lineHeight: '1.5' }}>
                                Instructions passed to Claude when a new agent session starts. Leave blank to use no system prompt.
                            </p>
                            {promptError && <span style={{ color: color.danger, fontSize: '12px' }}>{promptError}</span>}
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <span style={labelSty}>System prompt</span>
                                <textarea
                                    value={prompt}
                                    onChange={e => setPrompt(e.target.value)}
                                    placeholder="You are a helpful assistant specialized in..."
                                    rows={8}
                                    style={{
                                        ...inputSty,
                                        resize: 'vertical',
                                        fontFamily: '"JetBrains Mono", monospace',
                                        fontSize: '12px',
                                        lineHeight: '1.6',
                                    }}
                                />
                            </label>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={onClose} style={cancelSty}>Cancel</button>
                                <button type="submit" disabled={promptLoading} style={saveSty(promptLoading, promptSaved)}>
                                    {promptSaved ? '✓ Saved' : promptLoading ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* ── PERMISSIONS ── */}
                    {tab === 'permissions' && (
                        <form onSubmit={savePermissions} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <p style={{ margin: 0, color: M.faint, fontSize: '12px', lineHeight: '1.5' }}>
                                Saved to the project's .claude/settings.json. Takes effect on next agent start.
                            </p>
                            {permError && <span style={{ color: color.danger, fontSize: '12px' }}>{permError}</span>}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <span style={labelSty}>Allow</span>
                                <TagInput
                                    tags={allow}
                                    onChange={setAllow}
                                    placeholder={permFetching ? '' : 'Type a rule and press Enter…'}
                                    disabled={permFetching}
                                    tagColor={color.success}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <span style={labelSty}>Deny</span>
                                <TagInput
                                    tags={deny}
                                    onChange={setDeny}
                                    placeholder={permFetching ? '' : 'Type a rule and press Enter…'}
                                    disabled={permFetching}
                                    tagColor={color.danger}
                                />
                            </div>
                            <p style={{ margin: 0, color: M.faint, fontSize: '10px', lineHeight: '1.5' }}>
                                Rules follow Claude Code syntax, e.g.{' '}
                                <code style={{ fontFamily: 'monospace', color: M.body }}>Bash(*)</code>,{' '}
                                <code style={{ fontFamily: 'monospace', color: M.body }}>Bash(npm run *)</code>,{' '}
                                <code style={{ fontFamily: 'monospace', color: M.body }}>Read</code>.{' '}
                                Press Enter to add. Leave both empty to rely on interactive prompts.
                            </p>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={onClose} style={cancelSty}>Cancel</button>
                                <button type="submit" disabled={permFetching || permSaving} style={saveSty(permSaving, permSaved)}>
                                    {permSaved ? '✓ Saved' : permSaving ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    )
}
