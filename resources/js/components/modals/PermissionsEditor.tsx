import { color } from '@/tokens'
import { TagInput } from '@/components/ui/TagInput'

export function PermissionsEditor({
    title,
    subtitle,
    allow,
    deny,
    onChange,
    loading,
    fetching,
    error,
    onSubmit,
    onClose,
}: {
    title: React.ReactNode
    subtitle: string
    allow: string[]
    deny: string[]
    onChange: (field: 'allow' | 'deny', tags: string[]) => void
    loading: boolean
    fetching?: boolean
    error: string
    onSubmit: (e: React.FormEvent) => void
    onClose: () => void
}) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <div className="bg-[#1c1f26] border border-[#2a2f3a] rounded-md p-6 w-[480px] flex flex-col gap-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
                    <div>
                        <h2 className="mt-0 mx-0 mb-1 text-[#f0f6fc] text-[15px] font-semibold">
                            {title}
                        </h2>
                        <p className="m-0 text-[#8b949e] text-[11px]">{subtitle}</p>
                    </div>
                    {error && <span className="text-danger text-[12px]">{error}</span>}
                    <div className="flex flex-col gap-1">
                        <span className="text-[#8b949e] text-[11px] uppercase tracking-[0.05em]">Allow</span>
                        <TagInput
                            tags={allow}
                            onChange={tags => onChange('allow', tags)}
                            placeholder={fetching ? '' : 'Type a rule and press Enter…'}
                            disabled={fetching}
                            tagColor={color.success}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[#8b949e] text-[11px] uppercase tracking-[0.05em]">Deny</span>
                        <TagInput
                            tags={deny}
                            onChange={tags => onChange('deny', tags)}
                            placeholder={fetching ? '' : 'Type a rule and press Enter…'}
                            disabled={fetching}
                            tagColor={color.danger}
                        />
                    </div>
                    <p className="m-0 text-[#6e7681] text-[10px] leading-normal">
                        Rules follow Claude Code syntax, e.g. <code className="font-mono text-[#8b949e]">Bash(*)</code>,{' '}
                        <code className="font-mono text-[#8b949e]">Bash(npm run *)</code>,{' '}
                        <code className="font-mono text-[#8b949e]">Read</code>.{' '}
                        Press Enter to add. Leave both empty to rely on interactive prompts.
                    </p>
                    <div className="flex gap-2 justify-end">
                        <button
                            type="button" onClick={onClose}
                            className="bg-transparent border border-[#2a2f3a] rounded text-[#8b949e] text-[12px] py-1.5 px-3.5 cursor-pointer"
                        >Cancel</button>
                        <button
                            type="submit" disabled={fetching || loading}
                            className={`bg-blue-600 border-0 rounded text-white text-[12px] font-semibold py-1.5 px-3.5 ${(fetching || loading) ? 'cursor-default' : 'cursor-pointer'} ${loading ? 'opacity-70' : 'opacity-100'}`}
                        >
                            {loading ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
