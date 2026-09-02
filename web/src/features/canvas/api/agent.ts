import { getAuthToken } from "@/features/auth/stores/use-user-store";
import { serverBaseUrl } from "@/services/api/server";
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

type ApiResponse<T> = { code: number; data: T; msg: string };

/**
 * 发起 Agent 对话，返回 sessionId 供前端订阅事件流
 */
export async function agentChat(params: AgentChatParams): Promise<{ sessionId: string; requestId: string; status: AgentRequestStatus }> {
    const token = getAuthToken();
    const res = await fetch(`${serverBaseUrl()}/ai/agent/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store",
        body: JSON.stringify(params),
    });
    const payload = (await res.json().catch(() => null)) as ApiResponse<{ sessionId: string; requestId: string; status: AgentRequestStatus }> | null;
    if (!res.ok || !payload) throw new Error(payload?.msg || `Agent Chat 请求失败: ${res.status}`);
    if (payload.code !== 0) throw new Error(payload.msg || "Agent Chat 请求失败");
    return payload.data;
}

/**
 * 停止当前 Agent 会话及其关联的生成任务。
 */
export async function cancelAgentChat(sessionId: string, requestId: string): Promise<void> {
    const token = getAuthToken();
    const res = await fetch(`${serverBaseUrl()}/ai/agent/cancelChat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store",
        body: JSON.stringify({ sessionId, requestId }),
    });
    const payload = (await res.json().catch(() => null)) as ApiResponse<null> | null;
    if (!res.ok || !payload || payload.code !== 0) {
        throw new Error(payload?.msg || `停止 Agent 对话失败: ${res.status}`);
    }
}

/**
 * 按请求ID查询主Agent请求状态，用于SSE终态事件丢失时对账。
 */
export async function agentRequestStatus(requestId: string): Promise<{ status: AgentRequestStatus; message: string }> {
    const token = getAuthToken();
    const res = await fetch(`${serverBaseUrl()}/ai/agent/requestStatus?requestId=${encodeURIComponent(requestId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
    });
    const payload = (await res.json().catch(() => null)) as ApiResponse<{ status: AgentRequestStatus; message: string }> | null;
    if (!res.ok || !payload) throw new Error(payload?.msg || `Agent 请求状态查询失败: ${res.status}`);
    if (payload.code !== 0) throw new Error(payload.msg || "Agent 请求状态查询失败");
    return payload.data;
}

/**
 * 订阅 SSE 事件流。EventSource 无法设置自定义头，通过 query token 传递鉴权令牌。
 */
export function agentSubscribeEvents(): EventSource {
    const token = getAuthToken();
    const url = `${serverBaseUrl()}/ai/agent/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    return new EventSource(url);
}

/**
 * 回传前端工具执行结果
 */
export async function agentSubmitToolResult(params: AgentToolResultParams): Promise<void> {
    const token = getAuthToken();
    const res = await fetch(`${serverBaseUrl()}/ai/agent/tool-result`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store",
        body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Tool Result 提交失败: ${res.status}`);
}
