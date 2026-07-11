import { color } from '@/tokens'

export function SectionHeader({ title, count }: { title: string; count: number }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
            <span style={{ color: color.textPrimary, fontSize: '15px', fontWeight: 700 }}>{title}</span>
            <span style={{
                color: color.textMuted, fontSize: '12px', fontWeight: 600,
                fontFamily: '"JetBrains Mono", monospace',
            }}>{count}</span>
        </div>
    )
}
