import { Info } from "lucide-react"
import { color } from "@/tokens"
import { router } from "@inertiajs/react"

export default function AppHeader() {
    return (
        <header className="shrink-0 bg-white flex items-stretch" style={{ height: "48px", borderBottom: `1px solid ${color.stroke}`, zIndex: 20 }}>

            {/* Logo zone — same width as sidebar; doubles as the Dashboard (home) link */}
            <button
                type="button"
                onClick={() => router.visit("/")}
                aria-label="Go to Dashboard"
                title="Dashboard"
                className="shrink-0 flex items-center gap-2.5 px-4 text-left cursor-pointer transition-colors hover:bg-black/[0.03]"
                style={{ width: "220px", borderRight: `1px solid ${color.stroke}` }}
            >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: color.accent }}>
                    <Info size={14} color="white"/>
                </div>
                <span style={{ fontWeight: 700, fontSize: "14px", color: color.textPrimary, letterSpacing: "-0.01em" }}>
                        Keera Agent
                </span>
            </button>

            {/* Center flex zone — reserved for project-level nav tabs (rendered by ProjectLayout) */}
            <div className="flex items-stretch flex-1"/>

            {/* Right: avatar */}
            <div className="flex items-center gap-1 pr-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white cursor-pointer ml-1 shrink-0" style={{ background: "#7c6af7" }}>
                    B
                </div>
            </div>
        </header>
    )
}
