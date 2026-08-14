"use client";

import { useCallback, useEffect, useRef } from "react";

import { agentChat, agentSubscribeEvents, agentSubmitToolResult, cancelAgentChat, type AgentChatHistoryMessage, type AgentEvent } from "@/features/canvas/api/agent";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { isTerminalAgentRequestStatus, matchesAgentRequest, shouldApplyAgentQueueStatus, type AgentQueueStatus } from "@/features/chat/agent-event-match";
import { readAiTaskError } from "@/services/api/server";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { resolveCanvasAgentTool, type CanvasAgentToolResult } from "../utils/canvas-agent-tools";

type CanvasAgentApplyResult = {
  snapshot: CanvasAgentSnapshot;
  result?: CanvasAgentToolResult;
};

interface UseAgentSSEProps {
  snapshot: CanvasAgentSnapshot;
  onApplyOps: (ops: CanvasAgentOp[] | undefined, signal: AbortSignal) => Promise<CanvasAgentApplyResult>;
  onToolExecute?: () => void;
  onTextDelta: (messageId: string, delta: string) => void;
  onThoughtDelta?: (thoughtId: string, delta: string) => void;
  onThoughtComplete?: (thoughtId: string, durationMs: number) => void;
  onTaskComplete: (messageId: string, text: string) => void;
  onCanceled?: (message: string) => void;
  onPlanCreated?: (planId: string, summary: string, taskCount: number) => void;
  onPlanTaskStatus?: (planId: string, taskId: string, status: string, message: string) => void;
  onPromptPrepared?: (planId: string, taskId: string, strategy: "KEEP" | "OPTIMIZE") => void;
  onQueueStatus?: (status: "queued" | "running") => void;
  onRequestFinished?: () => void;
  onError: (message: string) => void;
}

/**
 * Agent SSE 通信 Hook。建立 SSE 长连接，处理文本增量、工具执行、任务完成和错误事件。
 * 画布写操作工具通过 onApplyOps 应用到画布，并将执行结果回传后端继续 Agent Loop。
 */
export function useAgentSSE({ snapshot, onApplyOps, onToolExecute, onTextDelta, onThoughtDelta, onThoughtComplete, onTaskComplete, onCanceled, onPlanCreated, onPlanTaskStatus, onPromptPrepared, onQueueStatus, onRequestFinished, onError }: UseAgentSSEProps) {
  const sessionIdRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef<string | undefined>(undefined);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseEnabledRef = useRef(false);
  const connectSSERef = useRef<() => void>(() => undefined);
  const sendingRef = useRef(false);
  const activeRequestRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const canceledHandledRef = useRef(false);
  const pendingEventsRef = useRef<AgentEvent[]>([]);
  const queueStatusRef = useRef<AgentQueueStatus | null>(null);
  const terminalRequestIdsRef = useRef(new Set<string>());
  const activeToolControllersRef = useRef(new Map<string, AbortController>());
  const snapshotRef = useRef(snapshot);
  const onApplyOpsRef = useRef(onApplyOps);
  const onToolExecuteRef = useRef(onToolExecute);
  const onTextDeltaRef = useRef(onTextDelta);
  const onThoughtDeltaRef = useRef(onThoughtDelta);
  const onThoughtCompleteRef = useRef(onThoughtComplete);
  const onTaskCompleteRef = useRef(onTaskComplete);
  const onCanceledRef = useRef(onCanceled);
  const onPlanCreatedRef = useRef(onPlanCreated);
  const onPlanTaskStatusRef = useRef(onPlanTaskStatus);
  const onPromptPreparedRef = useRef(onPromptPrepared);
  const onQueueStatusRef = useRef(onQueueStatus);
  const onRequestFinishedRef = useRef(onRequestFinished);
  const onErrorRef = useRef(onError);
  snapshotRef.current = snapshot;
  onApplyOpsRef.current = onApplyOps;
  onToolExecuteRef.current = onToolExecute;
  onTextDeltaRef.current = onTextDelta;
  onThoughtDeltaRef.current = onThoughtDelta;
  onThoughtCompleteRef.current = onThoughtComplete;
  onTaskCompleteRef.current = onTaskComplete;
  onCanceledRef.current = onCanceled;
  onPlanCreatedRef.current = onPlanCreated;
  onPlanTaskStatusRef.current = onPlanTaskStatus;
  onPromptPreparedRef.current = onPromptPrepared;
  onQueueStatusRef.current = onQueueStatus;
  onRequestFinishedRef.current = onRequestFinished;
  onErrorRef.current = onError;

  const markRequestTerminal = useCallback((requestId?: string) => {
    if (!requestId) return;
    const terminalRequestIds = terminalRequestIdsRef.current;
    if (terminalRequestIds.size >= 128) {
      const oldestRequestId = terminalRequestIds.values().next().value;
      if (oldestRequestId) terminalRequestIds.delete(oldestRequestId);
    }
    terminalRequestIds.add(requestId);
  }, []);

  const finishCanceledRequest = useCallback((requestId: string, message: string) => {
    if (canceledHandledRef.current) return;
    canceledHandledRef.current = true;
    markRequestTerminal(requestId);
    cancelRequestedRef.current = false;
    activeRequestRef.current = false;
    queueStatusRef.current = null;
    activeToolControllersRef.current.forEach((controller) => controller.abort());
    activeToolControllersRef.current.clear();
    onCanceledRef.current?.(message);
  }, [markRequestTerminal]);

  const flushPendingEvents = useCallback((sessionId: string, requestId: string) => {
    const pendingEvents = pendingEventsRef.current;
    pendingEventsRef.current = [];
    const eventSource = eventSourceRef.current;
    if (!eventSource) return;
    pendingEvents
      .filter((event) => matchesAgentRequest(event, sessionId, requestId))
      .forEach((event) => eventSource.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event) })));
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // connectSSE 不依赖任何回调引用，所有回调通过 ref 访问，保证 SSE 连接只建立一次。
  const connectSSE = useCallback(() => {
    clearReconnectTimer();
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const es = agentSubscribeEvents();
    eventSourceRef.current = es;

    const readCurrentEvent = (event: MessageEvent): AgentEvent | null => {
      try {
        const data: AgentEvent = JSON.parse(event.data);
        if (data.requestId && terminalRequestIdsRef.current.has(data.requestId)) return null;
        if (matchesAgentRequest(data, sessionIdRef.current, requestIdRef.current)) return data;
        if (sendingRef.current && data.requestId) {
          const pendingEvents = pendingEventsRef.current;
          if (pendingEvents.length >= 128) pendingEvents.shift();
          pendingEvents.push(data);
        }
        return null;
      } catch {
        return null;
      }
    };

    es.addEventListener("queue-status", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data || (data.status !== "queued" && data.status !== "running")) return;
      if (cancelRequestedRef.current) return;
      if (!shouldApplyAgentQueueStatus(queueStatusRef.current, data.status)) return;
      queueStatusRef.current = data.status;
      activeRequestRef.current = true;
      onQueueStatusRef.current?.(data.status);
    });

    // 文本增量事件
    es.addEventListener("text-delta", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      if (data.messageId && data.delta) onTextDeltaRef.current(data.messageId, data.delta);
    });

    // 主Agent思考事件仅更新当前页面的瞬时展示状态。
    es.addEventListener("thought-delta", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      if (data.thoughtId && data.thoughtDelta) onThoughtDeltaRef.current?.(data.thoughtId, data.thoughtDelta);
    });

    es.addEventListener("thought-complete", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      if (data.thoughtId) onThoughtCompleteRef.current?.(data.thoughtId, data.thoughtDurationMs ?? 0);
    });

    // 工具执行事件：将工具参数转为画布操作并应用，再回传结果给后端
    es.addEventListener("tool-execute", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      if (!data.name || !data.callId) return;
      const sessionId = data.sessionId;
      if (!sessionId) return;
      void (async () => {
        const controller = new AbortController();
        activeToolControllersRef.current.set(data.callId!, controller);
        try {
          onToolExecuteRef.current?.();
          const execution = resolveCanvasAgentTool(data.name!, data.arguments);
          if (!execution) throw new Error(`不支持的画布工具: ${data.name}`);
          let result = execution.result;
          if (execution.ops.length > 0 && result.ok) {
            const application = await onApplyOpsRef.current(execution.ops, controller.signal);
            snapshotRef.current = application.snapshot;
            result = application.result || result;
          }
          if (controller.signal.aborted) return;
          const requestId = data.requestId;
          if (!requestId) return;
          await agentSubmitToolResult({ sessionId, requestId, callId: data.callId!, result });
        } catch (err) {
          const canceled = controller.signal.aborted;
          if (canceled) return;
          const requestId = data.requestId;
          if (requestId) {
            await agentSubmitToolResult({
              sessionId,
              requestId,
              callId: data.callId!,
              result: {
                ok: false,
                message: err instanceof Error ? err.message : "工具执行失败",
                data: { error: readAiTaskError(err) },
              },
            }).catch(() => undefined);
          }
        } finally {
          activeToolControllersRef.current.delete(data.callId!);
        }
      })();
    });

    // 任务完成事件
    es.addEventListener("task-complete", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      activeRequestRef.current = false;
      queueStatusRef.current = null;
      markRequestTerminal(data.requestId);
      onTaskCompleteRef.current(data.messageId || "", data.text || "");
    });

    es.addEventListener("canceled", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      finishCanceledRequest(data.requestId || "", data.text || "已停止生成");
    });

    es.addEventListener("tool-cancel", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      if (!data.callId) return;
      activeToolControllersRef.current.get(data.callId)?.abort();
      activeToolControllersRef.current.delete(data.callId);
    });

    // 展示主Agent计划摘要和确定性执行阶段。
    es.addEventListener("plan-created", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      onPlanCreatedRef.current?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.summary || data.text || ""),
        Number(data.resultData?.taskCount || 0),
      );
    });

    es.addEventListener("plan-task-status", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      onPlanTaskStatusRef.current?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.taskId || data.callId || ""),
        data.status || "",
        String(data.resultData?.message || data.text || ""),
      );
    });

    es.addEventListener("prompt-prepared", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      onPromptPreparedRef.current?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.taskId || data.callId || ""),
        String(data.resultData?.strategy || "KEEP") as "KEEP" | "OPTIMIZE",
      );
    });

    // 错误事件
    es.addEventListener("error", (e: MessageEvent) => {
      // 浏览器原生 onerror 也会触发 error 监听，e.data 此时为 undefined，避免误解析
      if (!e.data) return;
      try {
        const data = readCurrentEvent(e);
        if (!data) return;
        activeRequestRef.current = false;
        queueStatusRef.current = null;
        markRequestTerminal(data.requestId);
        onErrorRef.current(data.errorMessage || "未知错误");
      } catch {
        onErrorRef.current("未知错误");
      }
    });

    // 连接异常时自动重连
    es.onerror = (event) => {
      if (event instanceof MessageEvent && event.data) return;
      if (!sseEnabledRef.current || eventSourceRef.current !== es || reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (sseEnabledRef.current && eventSourceRef.current === es) {
          connectSSERef.current();
        }
      }, 3000);
    };
  }, [clearReconnectTimer, finishCanceledRequest, markRequestTerminal]);

  connectSSERef.current = connectSSE;

  /**
   * 发送用户消息，携带当前画布快照、引用和选择的模型。
   * 使用 sendingRef 同步锁防止同一事件循环内重复提交（React setState 异步导致 isRunning 守卫失效）。
   */
  const sendMessage = useCallback(
    async (message: string, references?: { title: string; text: string }[], model?: string, history?: AgentChatHistoryMessage[], generationStyleIdsByType?: { image?: number[]; video?: number[] }) => {
      if (sendingRef.current || activeRequestRef.current) return;
      sendingRef.current = true;
      activeRequestRef.current = true;
      cancelRequestedRef.current = false;
      canceledHandledRef.current = false;
      const previousSessionId = sessionIdRef.current;
      requestIdRef.current = undefined;
      pendingEventsRef.current = [];
      queueStatusRef.current = "queued";
      try {
        const { sessionId, requestId, status } = await agentChat({
          sessionId: previousSessionId,
          entrySource: "canvas",
          message,
          canvasSnapshot: snapshotRef.current as unknown as Record<string, unknown>,
          references,
          history,
          creationSettings: model || generationStyleIdsByType ? { model, generationStyleIdsByType } : undefined,
        });
        sessionIdRef.current = sessionId;
        requestIdRef.current = requestId;
        if ((status === "queued" || status === "running") && shouldApplyAgentQueueStatus(queueStatusRef.current, status)) {
          queueStatusRef.current = status;
          onQueueStatusRef.current?.(status);
        } else if (status !== "queued" && status !== "running") {
          flushPendingEvents(sessionId, requestId);
          markRequestTerminal(requestId);
          activeRequestRef.current = false;
          queueStatusRef.current = null;
          onRequestFinishedRef.current?.();
        }
        if (!isTerminalAgentRequestStatus(status)) {
          flushPendingEvents(sessionId, requestId);
        }
        if (cancelRequestedRef.current && !isTerminalAgentRequestStatus(status)) {
          try {
            await cancelAgentChat(sessionId, requestId);
            finishCanceledRequest(requestId, "已停止生成");
          } catch (error) {
            cancelRequestedRef.current = false;
            throw error;
          }
        }
      } catch (error) {
        pendingEventsRef.current = [];
        activeRequestRef.current = false;
        queueStatusRef.current = null;
        throw error;
      } finally {
        sendingRef.current = false;
      }
    },
    [finishCanceledRequest, flushPendingEvents, markRequestTerminal],
  );

  /**
   * 重置后端 Agent 会话游标，用于前端新建独立对话。
   * 当前请求仍在排队或运行时不能重置，避免后续 SSE 事件失去请求归属。
   */
  const resetSession = useCallback((): boolean => {
    if (sendingRef.current || activeRequestRef.current) return false;
    activeToolControllersRef.current.forEach((controller) => controller.abort());
    activeToolControllersRef.current.clear();
    cancelRequestedRef.current = false;
    canceledHandledRef.current = false;
    sessionIdRef.current = undefined;
    requestIdRef.current = undefined;
    pendingEventsRef.current = [];
    queueStatusRef.current = null;
    return true;
  }, []);

  const cancelMessage = useCallback(async () => {
    activeToolControllersRef.current.forEach((controller) => controller.abort());
    activeToolControllersRef.current.clear();
    cancelRequestedRef.current = true;
    if (!sessionIdRef.current || !requestIdRef.current) {
      if (!sendingRef.current) cancelRequestedRef.current = false;
      return;
    }
    try {
      await cancelAgentChat(sessionIdRef.current, requestIdRef.current);
      finishCanceledRequest(requestIdRef.current, "已停止生成");
    } catch (error) {
      if (!sendingRef.current) cancelRequestedRef.current = false;
      throw error;
    }
  }, [finishCanceledRequest]);

  const token = useUserStore((s) => s.token);

  // 仅登录后建立 SSE 连接，token 变化时自动重连
  useEffect(() => {
    if (!token) {
      sseEnabledRef.current = false;
      clearReconnectTimer();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }
    sseEnabledRef.current = true;
    connectSSE();
    return () => {
      sseEnabledRef.current = false;
      clearReconnectTimer();
      eventSourceRef.current?.close();
      activeToolControllersRef.current.forEach((controller) => controller.abort());
      activeToolControllersRef.current.clear();
    };
  }, [token, clearReconnectTimer, connectSSE]);

  return { sendMessage, cancelMessage, resetSession };
}
