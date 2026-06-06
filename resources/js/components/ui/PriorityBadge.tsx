import { color } from '@/tokens'

const PRIORITY_STYLES: Record<string, { bg: string; color: string; border: string }> = {
    low:    { bg: color.bgSurface, color: color.textMuted, border: color.borderMuted },
    medium: { bg: color.priorityMediumBg, color: color.warning, border: color.warningSubtle },
    high:   { bg: color.dangerCanvas, color: color.danger, border: color.dangerSubtle },
}

export function PriorityBadge({ priority }: { priority: string }) {
    const s = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium
    return (
        <span style={{
            fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em',
            padding: '1px 6px', borderRadius: '10px',
            background: s.bg, border: `1px solid ${s.border}`, color: s.color,
            textTransform: 'uppercase', flexShrink: 0,
        }}>
            {priority}
        </span>
    )
}
