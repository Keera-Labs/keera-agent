import AppLayout from "@/layouts/AppLayout"
import { ProjectLayout } from "@/layouts/ProjectLayout"

export function Project() {}

// Nested persistent layouts — see Home.tsx for why both must be listed here.
Project.layout = [AppLayout, ProjectLayout];
