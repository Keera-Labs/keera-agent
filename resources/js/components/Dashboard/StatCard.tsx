import { color } from '@/tokens'

export function StatCard({ label, value, dot }: { label: string; value: number; dot: string }) {
    return (
        <div style={{
            flex: 1, minWidth: 0,
            background: color.bgSurface,
            border: `1px solid ${color.border}`,
            borderRadius: '8px',
            padding: '14px 16px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
                <span style={{
                    color: color.textMuted, fontSize: '11px', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{label}</span>
            </div>
            <div style={{ color: color.textPrimary, fontSize: '28px', fontWeight: 700, lineHeight: 1 }}>
                {value}
            </div>
        </div>
    )
}
