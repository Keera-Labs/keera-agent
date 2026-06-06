// ─── Audio notifications ───────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
    if (!_audioCtx) _audioCtx = new AudioContext()
    return _audioCtx
}

function playSound(type: 'done' | 'input') {
    try {
        const ctx = getAudioCtx()
        const gain = ctx.createGain()
        gain.connect(ctx.destination)

        if (type === 'done') {
            // Two-tone ascending ding: task completed
            const freqs = [880, 1100]
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator()
                osc.type = 'sine'
                osc.frequency.value = freq
                const g = ctx.createGain()
                g.gain.setValueAtTime(0, ctx.currentTime + i * 0.12)
                g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.12 + 0.02)
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.28)
                osc.connect(g)
                g.connect(ctx.destination)
                osc.start(ctx.currentTime + i * 0.12)
                osc.stop(ctx.currentTime + i * 0.12 + 0.28)
            })
        } else {
            // Soft double-pulse: needs user input
            const freqs = [660, 660]
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator()
                osc.type = 'sine'
                osc.frequency.value = freq
                const g = ctx.createGain()
                g.gain.setValueAtTime(0, ctx.currentTime + i * 0.18)
                g.gain.linearRampToValueAtTime(0.14, ctx.currentTime + i * 0.18 + 0.02)
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.18)
                osc.connect(g)
                g.connect(ctx.destination)
                osc.start(ctx.currentTime + i * 0.18)
                osc.stop(ctx.currentTime + i * 0.18 + 0.18)
            })
        }
    } catch { /* AudioContext not available */ }
}

export function useAudio() {
    return { playSound }
}
