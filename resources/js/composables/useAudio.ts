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

/** A soft double-pulse: an agent is asking the user a question. */
export function playQuestionSound() {
    try {
        playTones(getAudioCtx(), [660, 660], 0.18, 0.14, 0.18)
    } catch {
        // AudioContext not available
    }
}
