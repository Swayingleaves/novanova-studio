import { useTeamStore } from "@/features/team/stores/use-team-store";

import { currentWebsiteLocale } from "@/features/locale/translate";
import { getAuthToken } from "@/features/auth/stores/use-user-store";
import { serverBaseUrl, serverGet, serverPost } from "@/services/api/server";
import type { ServerSystemMessage } from "@/services/api/server";
import type { VideoGenerationMode } from "@/features/settings/stores/use-config-store";

export type AgentAttachment = {
    url: string;
    type: string;
    name: string;
    storageKey?: string;
    /** 工作流内媒体业务角色，由服务端按顺序解释。 */
    role?: string;
};

export type CreationSettings = {
    model?: string;
    size?: string;
    resolution?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    watermark?: boolean;
    generationStyleIds?: number[];
    generationStyleSnapshots?: GenerationStyleSnapshot[];
    generationStyleIdsByType?: { image?: number[]; video?: number[] };
    /** 视频生成模式，作为服务端 Agent 执行任务时不可被模型改写的约束。 */
    videoGenerationMode?: VideoGenerationMode;
    /** 画布 Agent 执行视频任务时固定使用的视频模型。 */
    videoModel?: string;
    /** 视频工作流图片阶段固定使用的图片模型。 */
    imageModel?: string;
    /** 视频工作流图片阶段宽高比。 */
    imageSize?: string;
    /** 视频工作流图片阶段清晰度。 */
    imageResolution?: string;
    /** 视频工作流图片阶段画质。 */
    imageQuality?: string;
    /** 设定图生成时锁定的目标图片节点。 */
    settingGraphNodeId?: string;
    /** 设定图技能快照，供历史节点复现流程。 */
    settingGraphSkillSnapshot?: { id: number; name: string; targetType: "canvasSettingGraph"; systemPrompt: string; aspectRatio?: string };
};

export type GenerationStyleSnapshot = {
    id: number;
    name: string;
    generationType: "image" | "video";
    stylePrompt: string;
};

export type AgentAction = {
    type: "navigate" | "choice";
    label: string;
    labelMessage?: ServerSystemMessage | null;
    href?: string;
    initialPrompt?: string;
    /** type=choice 时的可点击选项，点击后其 value 作为用户消息发送；multiple=true 时整组支持多选（勾选多个后提交，value 用顿号拼接）；action=upload_image 时点击直接触发页面参考图上传、不发送消息 */
    options?: { label: string; value: string; multiple?: boolean; action?: string }[];
};

export interface AgentChatParams {
    sessionId?: string;
    entrySource: "imagePage" | "videoPage" | "canvas";
    message: string;
    canvasSnapshot?: Record<string, unknown>;
    references?: { title: string; text: string }[];
    attachments?: AgentAttachment[];
    history?: AgentChatHistoryMessage[];
    creationSettings?: CreationSettings;
    /** 选中技能ID（图片/视频页 skills 功能，可为空） */
    skillId?: string;
    /** 画布设定图生成目标节点ID。 */
    settingGraphNodeId?: string;
    /** 画布设定图技能快照。 */
    settingGraphSkillSnapshot?: { id: number; name: string; targetType: "canvasSettingGraph"; systemPrompt: string; aspectRatio?: string };
}

export type AgentChatHistoryMessage = {
    role: "user" | "assistant";
    text: string;
};

export interface AgentToolResultParams {
    sessionId: string;
    requestId: string;
    callId: string;
    result: { ok: boolean; message: string; data?: Record<string, unknown> };
}

export interface AgentEvent {
    type: string;
    sessionId: string;
    requestId?: string;
    callId?: string;
    name?: string;
    arguments?: Record<string, unknown>;
    delta?: string;
    messageId?: string;
    text?: string;
    errorMessage?: string;
    systemMessage?: ServerSystemMessage | null;
    thoughtId?: string;
    thoughtDelta?: string;
    thoughtDurationMs?: number;
    resultOk?: boolean;
    resultMessage?: string;
    resultData?: Record<string, unknown>;
    progress?: number;
    taskId?: string;
    status?: string;
    action?: AgentAction;
}

export type AgentRequestStatus = "queued" | "running" | "success" | "failed" | "canceled" | "interrupted";

/** 发起对话，复用统一请求入口绑定当前团队及认证。 */
export function agentChat(params: AgentChatParams) {
    return serverPost<{ sessionId: string; requestId: string; status: AgentRequestStatus }>("/ai/agent/chat", params);
}

/** 停止当前空间中的请求及其关联任务。 */
export async function cancelAgentChat(sessionId: string, requestId: string): Promise<void> {
    await serverPost("/ai/agent/cancelChat", { sessionId, requestId });
}

/** 查询当前空间中的主Agent请求状态。 */
export function agentRequestStatus(requestId: string) {
    return serverGet<{ status: AgentRequestStatus; message: string }>(`/ai/agent/requestStatus?requestId=${encodeURIComponent(requestId)}`);
}

/** 查询当前空间、当前入口仍在执行的请求。 */
export function agentActiveRequest(entrySource: string) {
    return serverGet<{ requestId: string; sessionId: string; status: AgentRequestStatus; message: string; projectId: string } | null>(`/ai/agent/activeRequest?entrySource=${encodeURIComponent(entrySource)}`);
}

/** 页面刷新后重放当前空间中尚未执行的工具调用。 */
export function agentReplayPendingTools(params: { sessionId: string; requestId: string; activeToolCallIds: string[] }) {
    return serverPost<number>("/ai/agent/replayPendingTools", params);
}

/** EventSource通过查询参数显式传递团队，服务端验证成员关系。 */
export function agentSubscribeEvents(): EventSource {
    const token = getAuthToken();
    return new EventSource(`${serverBaseUrl()}/ai/agent/events?locale=${currentWebsiteLocale()}&teamId=${useTeamStore.getState().team?.id || 0}${token ? `&token=${encodeURIComponent(token)}` : ""}`);
}

/** 回传工具结果，同样验证原会话属于当前空间。 */
export async function agentSubmitToolResult(params: AgentToolResultParams): Promise<void> {
    await serverPost("/ai/agent/tool-result", params);
}
