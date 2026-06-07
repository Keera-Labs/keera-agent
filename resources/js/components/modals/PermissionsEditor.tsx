import { color } from '@/tokens'
import { TagInput } from '@/components/ui/TagInput'

// Dark modal palette
const M = { bg: '#1c1f26', border: '#2a2f3a', heading: '#f0f6fc', body: '#8b949e', faint: '#6e7681' }

export function PermissionsEditor({
    title,
    subtitle,
    allow,
    deny,
    onChange,
    loading,
    fetching,
    error,
    onSubmit,
    onClose,
}: {
    title: React.ReactNode
    subtitle: string
    allow: string[]
    deny: string[]
    onChange: (field: 'allow' | 'deny', tags: string[]) => void
    loading: boolean
    fetching?: boolean
    error: string
    onSubmit: (e: React.FormEvent) => void
    onClose: () => void
}) {
    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: M.bg, border: `1px solid ${M.border}`, borderRadius: '8px',
                padding: '24px', width: '480px', display: 'flex', flexDirection: 'column', gap: '14px',
                boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            }}>
                <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <h2 style={{ margin: '0 0 4px', color: M.heading, fontSize: '15px', fontWeight: 600 }}>
                            {title}
                        </h2>
                        <p style={{ margin: 0, color: M.body, fontSize: '11px' }}>{subtitle}</p>
                    </div>
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ color: M.body, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Allow</span>
                        <TagInput
                            tags={allow}
                            onChange={tags => onChange('allow', tags)}
                            placeholder={fetching ? '' : 'Type a rule and press Enter…'}
                            disabled={fetching}
                            tagColor={color.success}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ color: M.body, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deny</span>
                        <TagInput
                            tags={deny}
                            onChange={tags => onChange('deny', tags)}
                            placeholder={fetching ? '' : 'Type a rule and press Enter…'}
                            disabled={fetching}
                            tagColor={color.danger}
                        />
                    </div>
                    <p style={{ margin: 0, color: M.faint, fontSize: '10px', lineHeight: '1.5' }}>
                        Rules follow Claude Code syntax, e.g. <code style={{ fontFamily: 'monospace', color: M.body }}>Bash(*)</code>,{' '}
                        <code style={{ fontFamily: 'monospace', color: M.body }}>Bash(npm run *)</code>,{' '}
                        <code style={{ fontFamily: 'monospace', color: M.body }}>Read</code>.{' '}
                        Press Enter to add. Leave both empty to rely on interactive prompts.
                    </p>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                            type="button" onClick={onClose}
                            style={{ background: 'transparent', border: `1px solid ${M.border}`, borderRadius: '6px', color: M.body, fontSize: '12px', padding: '6px 14px', cursor: 'pointer' }}
                        >Cancel</button>
                        <button
                            type="submit" disabled={fetching || loading}
                            style={{ background: color.accentEmphasis, border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, padding: '6px 14px', cursor: (fetching || loading) ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}
                        >
                            {loading ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
