import useWorkspaces from "@/queries/useWorkspaces"
import { useAppLayout } from "@/layouts/context/AppLayoutContext"
import { color } from "@/tokens"
import { useEffect, useRef, useState } from "react"
import { ChevronsUpDown, Check, Trash2, Plus } from "lucide-react"

export function WorkspacePicker({
                                    selected,
                                    onSelect,
                                    onCreateWorkspace,
                                }: {
    selected: number | null
    onSelect: (id: number | null) => void
    onCreateWorkspace: () => void
}) {
    const { handleWorkspaceDeleted } = useAppLayout()
    const { workspaces, destroy } = useWorkspaces()
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
                <ChevronsUpDown size={12} color={color.textFaint} style={{ flexShrink: 0 }}/>
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
                            <Check size={10} color={color.accent} style={{ marginLeft: "auto" }}/>
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
                                    <Check size={10} color={color.accent} style={{ marginLeft: "auto" }}/>
                                )}
                            </button>
                            <button
                                onClick={e => {
                                    e.stopPropagation()
                                    destroy(w.id, handleWorkspaceDeleted)
                                }}
                                title="Delete workspace"
                                style={{
                                    background: "transparent", border: "none", cursor: "pointer",
                                    color: color.textFaint, padding: "7px 10px 7px 4px", display: "flex", alignItems: "center",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.color = color.danger)}
                                onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                            >
                                <Trash2 size={11}/>
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
                        <Plus size={10}/>
                        New Workspace
                    </button>
                </div>
            )}
        </div>
    )
}
