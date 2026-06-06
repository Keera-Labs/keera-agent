import { color } from '@/tokens'

// ─── Shared styles ────────────────────────────────────────────────────────────

export const labelStyle: React.CSSProperties = {
    color: color.textMuted,
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
}

export const inputStyle: React.CSSProperties = {
    background: color.bgBase,
    border: `1px solid ${color.borderMuted}`,
    borderRadius: '6px',
    color: color.textPrimary,
    fontSize: '13px',
    padding: '6px 10px',
    fontFamily: '"JetBrains Mono", monospace',
    outline: 'none',
}

export const cancelBtnStyle: React.CSSProperties = {
    background: 'transparent',
    border: `1px solid ${color.borderMuted}`,
    borderRadius: '6px',
    color: color.textMuted,
    fontSize: '12px',
    padding: '6px 14px',
    cursor: 'pointer',
}

export const submitBtnStyle: React.CSSProperties = {
    background: color.successEmphasis,
    border: `1px solid ${color.successBorder}`,
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    padding: '6px 14px',
    cursor: 'pointer',
}

export const flagRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    borderRadius: '6px',
    background: color.bgCanvas,
    border: `1px solid ${color.borderMuted}`,
    cursor: 'pointer',
}

export const toggleStyle = (on: boolean): React.CSSProperties => ({
    width: '32px',
    height: '18px',
    borderRadius: '9px',
    background: on ? color.accent : color.borderMuted,
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
    transition: 'background 0.15s',
})
