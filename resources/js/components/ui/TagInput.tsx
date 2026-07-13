import { useState, useRef } from 'react'

export function TagInput({
    tags,
    onChange,
    placeholder,
    disabled,
    tagColor,
}: {
    tags: string[]
    onChange: (tags: string[]) => void
    placeholder?: string
    disabled?: boolean
    tagColor: string
}) {
    const [input, setInput] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    function addTag(raw: string) {
        const value = raw.trim()
        if (value && !tags.includes(value)) {
            onChange([...tags, value])
        }
        setInput('')
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            e.preventDefault()
            addTag(input)
        } else if ((e.key === 'Backspace' || e.key === 'Delete') && input === '' && tags.length > 0) {
            onChange(tags.slice(0, -1))
        }
    }

    function removeTag(idx: number) {
        onChange(tags.filter((_, i) => i !== idx))
    }

    return (
        <div
            onClick={() => inputRef.current?.focus()}
            className={`flex flex-wrap gap-[5px] items-center bg-canvas border border-stroke rounded py-1.5 px-2 min-h-[38px] cursor-text ${disabled ? 'opacity-50' : 'opacity-100'}`}
        >
            {tags.map((tag, i) => (
                <span key={i}
                    className="inline-flex items-center gap-1 border rounded-sm py-0.5 px-1.5 font-mono text-[11px] leading-[1.4]"
                    style={{
                        background: tagColor + '22', borderColor: `${tagColor}55`,
                        color: tagColor,
                    }}
                >
                    {tag}
                    {!disabled && (
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); removeTag(i) }}
                            className="bg-transparent border-0 cursor-pointer p-0 leading-none text-[12px] flex items-center opacity-70"
                            style={{ color: tagColor }}
                        >×</button>
                    )}
                </span>
            ))}
            {!disabled && (
                <input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => { if (input.trim()) addTag(input) }}
                    placeholder={tags.length === 0 ? placeholder : ''}
                    className="bg-transparent border-0 outline-none py-0.5 px-0 font-mono text-[11px] text-zinc-900 min-w-[120px] flex-1"
                />
            )}
            {disabled && tags.length === 0 && (
                <span className="text-zinc-400 text-[11px] font-mono">
                    Loading…
                </span>
            )}
        </div>
    )
}
