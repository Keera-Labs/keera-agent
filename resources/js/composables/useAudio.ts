// ─── Audio notifications ───────────────────────────────────────────────────────

export type SoundType = 'done' | 'input'

let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
    if (!audioCtx) audioCtx = new AudioContext()
    return audioCtx
}

function playTones(ctx: AudioContext, freqs: number[], spacing: number, peak: number, length: number) {
    freqs.forEach((freq, i) => {
        const start = ctx.currentTime + i * spacing
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = freq
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(peak, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, start + length)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(start)
        osc.stop(start + length)
    })
}

export function playSound(type: SoundType) {
    try {
        const ctx = getAudioCtx()
        if (type === 'done') {
            // Two-tone ascending ding: task completed
            playTones(ctx, [880, 1100], 0.12, 0.18, 0.28)
        } else {
            // Soft double-pulse: needs user input
            playTones(ctx, [660, 660], 0.18, 0.14, 0.18)
        }
    } catch {
        // AudioContext not available
    }
}

export function useAudio() {
    return { playSound }
}
