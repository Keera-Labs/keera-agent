// ─── Agent color ──────────────────────────────────────────────────────────────

export function agentColor(name: string): string {
    const palette = ['#7c6af7', '#e8943f', '#3fb950', '#58a6ff', '#ff6b6b', '#ffa657', '#9b59b6', '#1abc9c']
    let h = 0
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
    return palette[Math.abs(h) % palette.length]
}
