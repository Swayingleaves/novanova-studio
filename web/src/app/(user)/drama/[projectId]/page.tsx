"use client";

import { useParams } from "@/shared/lib/team-navigation";
import { DramaWorkbench } from "@/features/drama/drama-workbench";

export default function DramaProjectPage() {
    const params = useParams<{ projectId: string }>();
    const projectId = params.projectId;
    if (!projectId) return null;
    return <DramaWorkbench projectId={projectId} />;
}
