import { color } from '@/tokens'
import { TagInput } from '@/components/ui/TagInput'
import { labelStyle, cancelBtnStyle, submitBtnStyle } from '@/components/ui/styles'

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
                background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '480px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <h2 style={{ margin: '0 0 4px', color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>
                            {title}
                        </h2>
                        <p style={{ margin: 0, color: color.textMuted, fontSize: '11px' }}>{subtitle}</p>
                    </div>
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Allow</span>
                        <TagInput
                            tags={allow}
                            onChange={tags => onChange('allow', tags)}
                            placeholder={fetching ? '' : 'Type a rule and press Enter…'}
                            disabled={fetching}
                            tagColor={color.success}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Deny</span>
                        <TagInput
                            tags={deny}
                            onChange={tags => onChange('deny', tags)}
                            placeholder={fetching ? '' : 'Type a rule and press Enter…'}
                            disabled={fetching}
                            tagColor={color.danger}
                        />
                    </div>
                    <p style={{ margin: 0, color: color.textFaint, fontSize: '10px', lineHeight: '1.5' }}>
                        Rules follow Claude Code syntax, e.g. <code style={{ fontFamily: 'monospace' }}>Bash(*)</code>, <code style={{ fontFamily: 'monospace' }}>Bash(npm run *)</code>, <code style={{ fontFamily: 'monospace' }}>Read</code>. Press Enter to add. Leave both empty to rely on interactive prompts.
                    </p>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                        <button type="submit" disabled={fetching || loading} style={submitBtnStyle}>
                            {loading ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
