"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Spin } from "antd";

import { ComicDramaProjectLibrary } from "@/features/comic-drama/components/comic-drama-project-library";
import { ComicDramaWorkspace } from "@/features/comic-drama/components/comic-drama-workspace";

function ComicDramaPageContent() {
    const searchParams = useSearchParams();
    const scriptProjectId = searchParams.get("scriptProjectId");
    const projectId = searchParams.get("projectId") || scriptProjectId;

    return projectId ? <ComicDramaWorkspace projectId={projectId} scriptProjectId={scriptProjectId || undefined} /> : <ComicDramaProjectLibrary />;
}

/** 漫剧创作菜单入口，根据查询参数在项目库与项目生产工作台之间切换。 */
export default function ComicDramaPage() {
    return (
        <Suspense fallback={<main className="studio-page flex h-full items-center justify-center"><Spin size="large" /></main>}>
            <ComicDramaPageContent />
        </Suspense>
    );
}
