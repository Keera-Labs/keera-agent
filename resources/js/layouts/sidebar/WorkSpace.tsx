import { useWorkspace } from "@/layouts/hooks/workspace"
import { color } from "@/tokens"
import { useEffect, useRef, useState } from "react"

export function WorkspacePicker({
                                    selected,
                                    onSelect,
                                    onCreateWorkspace,
                                }: {
    selected: number | null
    onSelect: (id: number | null) => void
    onCreateWorkspace: () => void
}) {
    const { workspaces, destroy } = useWorkspace()
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return

        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }

        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [open])

    const current = selected !== null ? workspaces.find(w => w.id === selected) ?? null : null

    return (
        <div style={{ padding: "8px 10px 6px", position: "relative" }} ref={ref}>
            <div style={{ padding: "0 4px 4px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: color.textFaint }}>
                Workspace
            </div>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    width: "100%", padding: "7px 10px", borderRadius: "8px",
                    background: color.bgSurface, border: `1px solid ${color.borderMuted}`,
                    cursor: "pointer", textAlign: "left",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                }}
            >
                <div style={{
                    width: "30px", height: "30px", borderRadius: "7px",
                    background: color.accentEmphasis,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "13px", fontWeight: 700, color: "#fff", flexShrink: 0,
                    letterSpacing: "-0.01em",
                }}>
                    {(current?.name[0] ?? "P").toUpperCase()}
                </div>
                <span style={{ color: color.textPrimary, fontSize: "13px", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {current?.name ?? "Personal Workspace"}
                </span>
                {/* Up/down chevrons */}
                <svg width="12" height="12" viewBox="0 0 16 16" fill={color.textFaint} style={{ flexShrink: 0 }}>
                    <path d="M5 7l3-3 3 3M5 9l3 3 3-3" stroke={color.textFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
            </button>

            {open && (
                <div style={{
                    position: "absolute", top: "calc(100% - 2px)", left: "10px", right: "10px", zIndex: 200,
                    background: color.bgSurface, border: `1px solid ${color.borderMuted}`,
                    borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                    padding: "4px 0", overflow: "hidden",
                }}>
                    <button
                        onClick={() => {
                            onSelect(null)
                            setOpen(false)
                        }}
                        style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            width: "100%", padding: "7px 12px", background: "transparent",
                            border: "none", cursor: "pointer", fontSize: "12px",
                            color: selected === null ? color.textPrimary : color.textSecondary,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                        All Projects
                        {selected === null && (
                            <svg width="10" height="10" viewBox="0 0 16 16" fill={color.accent} style={{ marginLeft: "auto" }}>
                                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                            </svg>
                        )}
                    </button>

                    {workspaces.map(w => (
                        <div key={w.id} style={{ display: "flex", alignItems: "center" }}>
                            <button
                                onClick={() => {
                                    onSelect(w.id)
                                    setOpen(false)
                                }}
                                style={{
                                    flex: 1, display: "flex", alignItems: "center", gap: "8px",
                                    padding: "7px 12px", background: "transparent",
                                    border: "none", cursor: "pointer", fontSize: "12px",
                                    color: selected === w.id ? color.textPrimary : color.textSecondary,
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                            >
                                {w.name}
                                {selected === w.id && (
                                    <svg width="10" height="10" viewBox="0 0 16 16" fill={color.accent} style={{ marginLeft: "auto" }}>
                                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={e => {
                                    e.stopPropagation()
                                    destroy(w.id)
                                }}
                                title="Delete workspace"
                                style={{
                                    background: "transparent", border: "none", cursor: "pointer",
                                    color: color.textFaint, padding: "7px 10px 7px 4px", display: "flex", alignItems: "center",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.color = color.danger)}
                                onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                            >
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 00.249.225h5.19a.25.25 0 00.249-.225l.66-6.6a.75.75 0 011.492.149l-.66 6.6A1.748 1.748 0 0110.595 15h-5.19a1.75 1.75 0 01-1.741-1.575l-.66-6.6a.75.75 0 011.492-.15z"/>
                                </svg>
                            </button>
                        </div>
                    ))}

                    <div style={{ height: "1px", background: color.border, margin: "4px 0" }}/>

                    <button
                        onClick={() => {
                            setOpen(false)
                            onCreateWorkspace()
                        }}
                        style={{
                            display: "flex", alignItems: "center", gap: "6px",
                            width: "100%", padding: "7px 12px", background: "transparent",
                            border: "none", cursor: "pointer", fontSize: "12px", color: color.accent,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = color.bgBase)}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                        </svg>
                        New Workspace
                    </button>
                </div>
            )}
        </div>
    )
}
