import AppLayout from '@/layouts/AppLayout'
import { ProjectLayout } from '@/layouts/ProjectLayout'

/**
 * Placeholder page for the agents route.
 * No backend route renders this component directly — the agents view is
 * embedded inside ProjectLayout (via Home.tsx).  This file exists solely to
 * prevent Vite from emitting a module-resolution error when it eagerly loads
 * all pages/**\/\*.tsx files in app.tsx.
 */
export default function AgentsIndex() {
    return null
}

AgentsIndex.layout = [AppLayout, ProjectLayout]
