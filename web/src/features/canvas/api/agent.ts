import { getAuthToken } from "@/features/auth/stores/use-user-store";
import { serverBaseUrl } from "@/services/api/server";

export type AgentAttachment = {
  url: string;
  type: string;
  name: string;
  storageKey?: string;
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
};

export type GenerationStyleSnapshot = {
  id: number;
  name: string;
  generationType: "image" | "video";
  stylePrompt: string;
};

export type AgentAction = {
  type: "navigate";
  label: string;
  href: string;
  initialPrompt?: string;
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
}

export type AgentChatHistoryMessage = {
  role: "user" | "assistant";
  text: string;
};

export interface AgentToolResultParams {
  sessionId: string;
  callId: string;
  result: { ok: boolean; message: string; data?: Record<string, unknown> };
}

export interface AgentEvent {
  type: string;
  sessionId: string;
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

type ApiResponse<T> = { code: number; data: T; msg: string };

/**
 * 发起 Agent 对话，返回 sessionId 供前端订阅事件流
 */
export async function agentChat(params: AgentChatParams): Promise<{ sessionId: string }> {
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
  const payload = (await res.json().catch(() => null)) as ApiResponse<{ sessionId: string }> | null;
  if (!res.ok || !payload) throw new Error(payload?.msg || `Agent Chat 请求失败: ${res.status}`);
  if (payload.code !== 0) throw new Error(payload.msg || "Agent Chat 请求失败");
  return payload.data;
}

/**
 * 停止当前 Agent 会话及其关联的生成任务。
 */
export async function cancelAgentChat(sessionId: string): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(`${serverBaseUrl()}/ai/agent/cancelChat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
    body: JSON.stringify({ sessionId }),
  });
  const payload = (await res.json().catch(() => null)) as ApiResponse<null> | null;
  if (!res.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `停止 Agent 对话失败: ${res.status}`);
  }
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
