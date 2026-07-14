import { useState } from 'react'
import { labelClass, inputClass, cancelBtnClass, submitBtnClass } from '@/components/ui/styles'

// Create-command form shown under the panel header. On submit it delegates the
// API call to the parent and only clears itself on success.
export function CommandForm({
    onCancel,
    onCreate,
}: {
    onCancel: () => void
    onCreate: (label: string, command: string) => Promise<string | null>
}) {
    const [label, setLabel] = useState('')
    const [cmd, setCmd] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        const err = await onCreate(label.trim(), cmd.trim())
        setLoading(false)
        if (err) setError(err)
    }

    return (
        <div className="py-[14px] px-5 border-b border-stroke bg-surface shrink-0">
            <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
                <div className="flex gap-2.5">
                    <div className="flex flex-col gap-1 flex-[0_0_180px]">
                        <span className={labelClass}>Label</span>
                        <input
                            autoFocus
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            placeholder="Dev Server"
                            required
                            className={`${inputClass} box-border w-full`}
                        />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                        <span className={labelClass}>Shell command</span>
                        <input
                            value={cmd}
                            onChange={e => setCmd(e.target.value)}
                            placeholder="npm run dev"
                            required
                            className={`${inputClass} box-border w-full font-mono`}
                        />
                    </div>
                </div>
                {error && <span className="text-danger text-[12px]">{error}</span>}
                <div className="flex gap-2 justify-end">
                    <button type="button" onClick={onCancel} className={cancelBtnClass}>Cancel</button>
                    <button type="submit" disabled={loading} className={submitBtnClass}>
                        {loading ? 'Adding…' : 'Add command'}
                    </button>
                </div>
            </form>
        </div>
    )
}
