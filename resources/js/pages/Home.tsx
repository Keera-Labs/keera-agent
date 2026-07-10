import AppLayout from '../layouts/AppLayout'
import { ProjectLayout } from "@/layouts/ProjectLayout"

export default function Home() {
    return (
        <div>Home</div>
    )
}

// Nested persistent layouts: AppLayout (outer) wraps ProjectLayout (inner).
// Inertia only reads `.layout` off the page component and does not recurse into
// a layout's own `.layout`, so both must be declared here as an array.
Home.layout = [AppLayout, ProjectLayout]
