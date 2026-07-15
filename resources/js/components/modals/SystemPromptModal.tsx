import { useState, useEffect } from 'react'
import type { Project } from '@/types/type'

export function SystemPromptModal({
    project,
    onClose,
    onUpdated,
}: {
    project: Project
    onClose: () => void
    onUpdated: (p: Project) => void
}) {
    const [prompt, setPrompt] = useState(project.system_prompt ?? '')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    // Sync the textarea when the parent passes updated project data (e.g. after
    // the React Query cache refreshes stale data after the modal opens).
    useEffect(() => {
        setPrompt(project.system_prompt ?? '')
    }, [project.system_prompt])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const res = await fetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ system_prompt: prompt.trim() || null }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            onUpdated(data as Project)
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <div className="bg-[#1c1f26] border border-[#2a2f3a] rounded-md p-6 w-[480px] flex flex-col gap-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                    <div>
                        <h2 className="mt-0 mx-0 mb-1 text-[#f0f6fc] text-[15px] font-semibold">
                            System Instructions —{' '}
                            <span className="font-mono text-accent">{project.name}</span>
                        </h2>
                        <p className="m-0 text-[#8b949e] text-[11px]">
                            Instructions passed to Claude when a new agent session starts. Leave blank to use no system prompt.
                        </p>
                    </div>
                    {error && <span className="text-danger text-[12px]">{error}</span>}
                    <label className="flex flex-col gap-1">
                        <span className="text-[#8b949e] text-[11px] uppercase tracking-[0.05em]">
                            System prompt
                        </span>
                        <textarea
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            placeholder="You are a helpful assistant specialized in..."
                            rows={8}
                            className="bg-[#0d1117] border border-[#2a2f3a] rounded text-[#e2e6ed] text-[12px] py-[7px] px-2.5 outline-none resize-y font-mono leading-normal"
                        />
                    </label>
                    <div className="flex gap-2 justify-end">
                        <button
                            type="button" onClick={onClose}
                            className="bg-transparent border border-[#2a2f3a] rounded text-[#8b949e] text-[12px] py-1.5 px-3.5 cursor-pointer"
                        >Cancel</button>
                        <button
                            type="submit" disabled={loading}
                            className={`bg-blue-600 border-0 rounded text-white text-[12px] font-semibold py-1.5 px-3.5 ${loading ? 'cursor-default opacity-70' : 'cursor-pointer opacity-100'}`}
                        >
                            {loading ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
