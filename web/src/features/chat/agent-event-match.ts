import type { AgentEvent } from "@/features/canvas/api/agent";

/**
 * 判断SSE事件是否属于当前提交的统一主Agent请求。
 */
export function matchesAgentRequest(event: AgentEvent, sessionId: string | undefined, requestId: string | undefined): boolean {
  return Boolean(sessionId && requestId && event.sessionId === sessionId && event.requestId === requestId);
}

export type AgentQueueStatus = "queued" | "running";

/**
 * 判断主Agent请求状态是否已经终止。
 */
export function isTerminalAgentRequestStatus(status: string | undefined): boolean {
  return status === "success" || status === "failed" || status === "canceled" || status === "interrupted";
}

/**
 * 主Agent状态只能从排队进入运行，不能因异步迟到的事件回退到排队。
 */
export function shouldApplyAgentQueueStatus(current: AgentQueueStatus | null, next: AgentQueueStatus): boolean {
  return current !== "running" || next === "running";
}
