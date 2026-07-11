import { color } from '@/tokens'

export function CenteredMessage({ text }: { text: string }) {
    return (
        <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '48px', color: color.textFaint, fontSize: '13px',
        }}>
            {text}
        </div>
    )
}
