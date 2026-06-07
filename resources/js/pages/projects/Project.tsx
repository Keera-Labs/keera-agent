import AppLayout from "@/layouts/AppLayout"
import { ProjectLayout } from "@/layouts/ProjectLayout"

export function Project() {}

Project.layout = (page: React.ReactNode) => (
    <ProjectLayout>
        {page}
    </ProjectLayout>
);
