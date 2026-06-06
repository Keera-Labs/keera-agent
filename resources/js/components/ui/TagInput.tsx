import { useState, useRef } from 'react'
import { color } from '@/tokens'

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
            style={{
                display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center',
                background: color.bgBase, border: `1px solid ${color.borderMuted}`, borderRadius: '6px',
                padding: '6px 8px', minHeight: '38px', cursor: 'text',
                opacity: disabled ? 0.5 : 1,
            }}
        >
            {tags.map((tag, i) => (
                <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    background: tagColor + '22', border: `1px solid ${tagColor}55`,
                    borderRadius: '4px', padding: '2px 6px',
                    fontFamily: '"JetBrains Mono", monospace', fontSize: '11px',
                    color: tagColor, lineHeight: '1.4',
                }}>
                    {tag}
                    {!disabled && (
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); removeTag(i) }}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: tagColor, padding: '0', lineHeight: 1, fontSize: '12px',
                                display: 'flex', alignItems: 'center', opacity: 0.7,
                            }}
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
                    style={{
                        background: 'none', border: 'none', outline: 'none', padding: '2px 0',
                        fontFamily: '"JetBrains Mono", monospace', fontSize: '11px',
                        color: color.textPrimary, minWidth: '120px', flex: 1,
                    }}
                />
            )}
            {disabled && tags.length === 0 && (
                <span style={{ color: color.textFaint, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>
                    Loading…
                </span>
            )}
        </div>
    )
}
