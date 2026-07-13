import { usePage } from '@inertiajs/react'
import AppLayout from '@/layouts/AppLayout'
import { ProjectLayout } from '@/layouts/ProjectLayout'
import { color } from '@/tokens'
import { CommandsPanel } from '@/pages/configurations/index'
import type { Command } from '@/pages/configurations/index'

export type * from '@/pages/configurations/types'

// Project Configurations screen served at "/{project}/configurations" via
// Inertia props. Commands are delivered by configurations_page_controller on
// every visit — no initial client fetch — so the panel can never fail to load.
export default function Configurations() {
    const { props } = usePage<{ project: string; project_id: number | null; commands: Command[] }>()

    if (props.project_id === null) {
        return (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: color.textFaint, fontSize: '13px' }}>Project not found</span>
            </div>
        )
    }

    return (
        <CommandsPanel
            projectId={props.project_id}
            projectSlug={props.project}
            initialCommands={props.commands ?? []}
        />
    )
}

// Nested persistent layouts — see Home.tsx for why both must be listed here.
Configurations.layout = [AppLayout, ProjectLayout]
