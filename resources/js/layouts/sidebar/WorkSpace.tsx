import useWorkspaces from "@/queries/workspacesQuery"
import { useAppLayout } from "@/layouts/context/AppLayoutContext"
import { color } from "@/tokens"
import { useEffect, useRef, useState } from "react"
import { ChevronsUpDown, Check, Trash2, Plus } from "lucide-react"
import WorkspaceAddModal from "@/components/WorkspaceAddModal"

export function WorkspacePicker({
                                    selected,
                                    onSelect,
                                }: {
    selected: number | null
    onSelect: (id: number | null) => void
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
        <div className="pt-2 px-2.5 pb-1.5 relative" ref={ref}>
            <div className="pt-0 px-1 pb-1 text-[10px] font-bold tracking-[0.08em] uppercase text-zinc-400">
                Workspace
            </div>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-2 w-full py-[7px] px-2.5 rounded-md bg-surface border border-stroke cursor-pointer text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            >
                <div className="w-[30px] h-[30px] rounded-[7px] bg-blue-600 flex items-center justify-center text-[13px] font-bold text-white shrink-0 tracking-[-0.01em]">
                    {(current?.name[0] ?? "P").toUpperCase()}
                </div>
                <span className="text-zinc-900 text-[13px] font-semibold flex-1 truncate">
                    {current?.name ?? "Personal Workspace"}
                </span>
                {/* Up/down chevrons */}
                <ChevronsUpDown size={12} color={color.textFaint} className="shrink-0"/>
            </button>

            {open && (
                <div className="absolute top-[calc(100%-2px)] left-2.5 right-2.5 z-[200] bg-surface border border-stroke rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1 px-0 overflow-hidden">
                    <button
                        onClick={() => {
                            onSelect(null)
                            setOpen(false)
                        }}
                        className={`flex items-center gap-2 w-full py-[7px] px-3 bg-transparent border-0 cursor-pointer text-[12px] hover:bg-canvas ${selected === null ? "text-zinc-900" : "text-zinc-700"}`}
                    >
                        All Projects
                        {selected === null && (
                            <Check size={10} color={color.accent} className="ml-auto"/>
                        )}
                    </button>

                    {workspaces.map(w => (
                        <div key={w.id} className="flex items-center">
                            <button
                                onClick={() => {
                                    onSelect(w.id)
                                    setOpen(false)
                                }}
                                className={`flex-1 flex items-center gap-2 py-[7px] px-3 bg-transparent border-0 cursor-pointer text-[12px] hover:bg-canvas ${selected === w.id ? "text-zinc-900" : "text-zinc-700"}`}
                            >
                                {w.name}
                                {selected === w.id && (
                                    <Check size={10} color={color.accent} className="ml-auto"/>
                                )}
                            </button>
                            <button
                                onClick={e => {
                                    e.stopPropagation()
                                    destroy(w.id, handleWorkspaceDeleted)
                                }}
                                title="Delete workspace"
                                className="bg-transparent border-0 cursor-pointer text-zinc-400 pt-[7px] pr-2.5 pb-[7px] pl-1 flex items-center hover:text-danger"
                            >
                                <Trash2 size={11}/>
                            </button>
                        </div>
                    ))}

                    <div className="h-px bg-stroke my-1 mx-0"/>

                    <WorkspaceAddModal
                        trigger={
                            <button
                                onClick={() => setOpen(false)}
                                className="flex items-center gap-1.5 w-full py-[7px] px-3 bg-transparent border-0 cursor-pointer text-[12px] text-accent hover:bg-canvas"
                            >
                                <Plus size={10}/>
                                New Workspace
                            </button>
                        }
                    />
                </div>
            )}
        </div>
    )
}
