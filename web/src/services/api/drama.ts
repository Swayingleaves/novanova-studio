import { serverGet, serverPost } from "@/services/api/server";

export const dramaStages = ["plan", "script", "cast", "shot"] as const;

export type DramaStage = (typeof dramaStages)[number];

export type DramaProjectView = {
    id: string;
    name: string;
    currentStage: DramaStage;
    status: string;
    revision: number;
    textModel: string;
    textCredits: string | number;
    durationSeconds: number;
    aspectRatio?: string;
    updatedAt: string;
    coverUrl?: string;
    coverStorageKey?: string;
};

export type DramaProjectDetail = DramaProjectView & {
    ideaText: string;
    storyText: string;
    sessionId: string;
};

export type DramaVersion = {
    id: string;
    stage: DramaStage;
    versionNumber: number;
    confirmationStatus: "pending" | "confirmed" | string;
    freshness: "current" | "needs_update" | string;
    content: Record<string, unknown>;
    createdAt: string;
    confirmedAt: string;
};

export type DramaActiveRequest = {
    requestId: string;
    status: string;
    message: string;
};

export type DramaMedia = {
    id: string;
    versionId: string;
    targetKey: string;
    mediaType: "image" | "video" | string;
    taskId: string;
    model: string;
    status: "pending" | "running" | "success" | "failed" | "canceled" | string;
    progress: number;
    url: string;
    storageKey: string;
    mimeType: string;
    errorMessage: string;
    createdAt: string;
};

export type DramaWorkspace = {
    project: DramaProjectDetail;
    versions: DramaVersion[];
    activeRequest: DramaActiveRequest;
    media?: DramaMedia[];
};

export type DramaProjectPage = {
    projects: DramaProjectView[];
    total: number;
};

export function listDramaProjects(page = 1, pageSize = 12) {
    return serverGet<DramaProjectPage>(`/drama/listProjects?page=${page}&pageSize=${pageSize}`);
}

export function createDramaProject(body: { clientRequestId: string; ideaText: string; storyText: string; textModel: string; aspectRatio: string }) {
    return serverPost<DramaWorkspace>("/drama/createProject", body);
}

export function getDramaWorkspace(projectId: string) {
    return serverGet<DramaWorkspace>(`/drama/getWorkspace?projectId=${encodeURIComponent(projectId)}`);
}

export function updateDramaProject(body: { projectId: string; revision: number; name: string; textModel: string; durationSeconds?: number; aspectRatio?: string }) {
    return serverPost<DramaWorkspace>("/drama/updateProject", body);
}

export function confirmDramaStage(body: { clientRequestId: string; projectId: string; revision: number; versionId: string }) {
    return serverPost<DramaWorkspace>("/drama/confirmStage", body);
}

export function sendDramaMessage(body: { clientRequestId: string; projectId: string; revision: number; message: string; viewedStage: string; imageModel?: string; videoModel?: string; imageQuality?: string; imageResolution?: string; videoResolution?: string }) {
    return serverPost<DramaWorkspace>("/drama/sendMessage", body);
}

export function deleteDramaProject(body: { projectId: string; revision: number }) {
    return serverPost<void>("/drama/deleteProject", body);
}

/** 撤销某阶段最新一次生成，连同该版本的图片和视频一起删除。 */
export function discardDramaVersion(body: { projectId: string; revision: number; versionId: string }) {
    return serverPost<DramaWorkspace>("/drama/discardVersion", body);
}

/** 重做某个阶段的产物：服务端直接按生成请求入队，不依赖对话意图判断。 */
export function regenerateDramaStage(body: { clientRequestId: string; projectId: string; revision: number; stage: DramaStage }) {
    return serverPost<DramaWorkspace>("/drama/regenerateStage", body);
}

export type DramaShotItem = {
    id: string;
    ref: string;
    order: number;
    durationSeconds: number;
    title: string;
    size: string;
    camera: string;
    picture: string;
    dialogue: string;
    videoPrompt: string;
    screenText: string;
    rhythm: string;
    characterRef: string;
    locationRef: string;
};

export function updateDramaShots(body: {
    projectId: string;
    revision: number;
    versionId: string;
    shots: Array<Omit<DramaShotItem, "order">>;
}) {
    return serverPost<DramaWorkspace>("/drama/updateShots", body);
}

export function generateDramaMedia(body: {
    clientRequestId: string;
    projectId: string;
    versionId: string;
    targetKey: string;
    model: string;
    parameters?: Record<string, unknown>;
    prompt?: string;
}) {
    return serverPost<DramaWorkspace>("/drama/generateMedia", body);
}
