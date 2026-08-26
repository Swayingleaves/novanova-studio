"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAction, AgentAttachment, AgentEvent, CreationSettings } from "@/features/canvas/api/agent";
import { agentChat, agentRequestStatus, agentSubscribeEvents, cancelAgentChat } from "@/features/canvas/api/agent";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { getAiTaskPollingIntervalMilliseconds } from "@/services/api/server";
import { isTerminalAgentRequestStatus, matchesAgentRequest, shouldApplyAgentQueueStatus, type AgentQueueStatus } from "./agent-event-match";
import type { ToolCallState } from "./types";

const CLOSED_CONNECTION_ERROR_PATTERN = /(?:java\.io\.IOException:\s*)?closed\b/i;

type UseAgentChatSSEProps = {
  entrySource: "imagePage" | "videoPage" | "canvas";
  creationSettings?: CreationSettings;
  onTextDelta?: (messageId: string, delta: string) => void;
  onThoughtDelta?: (thoughtId: string, delta: string) => void;
  onThoughtComplete?: (thoughtId: string, durationMs: number) => void;
  onToolCall?: (call: ToolCallState) => void;
  onToolProgress?: (callId: string, taskId: string, progress: number, status: string) => void;
  onToolResult?: (callId: string, ok: boolean, message: string, data?: Record<string, unknown>) => void;
  onTaskComplete?: (messageId: string, text: string, action?: AgentAction) => void;
  onCanceled?: (message: string) => void;
  onNotice?: (message: string) => void;
  onPlanCreated?: (planId: string, summary: string, taskCount: number) => void;
  onPlanTaskStatus?: (planId: string, taskId: string, status: string, message: string) => void;
  onPromptPrepared?: (planId: string, taskId: string, strategy: "KEEP" | "OPTIMIZE") => void;
  onQueueStatus?: (status: "queued" | "running") => void;
  onError?: (error: string) => void;
};

type AgentChatSSEReturn = {
  sessionId: string | null;
  requestId: string | null;
  isStreaming: boolean;
  isQueued: boolean;
  isStopping: boolean;
  sendMessage: (message: string, attachments?: AgentAttachment[], creationSettings?: CreationSettings) => Promise<void>;
  cancelMessage: () => Promise<void>;
  canChangeSession: () => boolean;
  resetSession: () => boolean;
  restoreSession: (sid: string) => boolean;
};

/**
 * 通用 Agent SSE 通信 Hook，支持画布、图片和视频三类入口来源。
 * 图片与视频入口下后端自行执行工具，前端透传事件给回调。
 */
export function useAgentChatSSE(props: UseAgentChatSSEProps): AgentChatSSEReturn {
  const { entrySource, creationSettings } = props;

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
  const cancelWaitersRef = useRef<Array<() => void>>([]);
  const pendingEventsRef = useRef<AgentEvent[]>([]);
  const queueStatusRef = useRef<AgentQueueStatus | null>(null);
  const terminalRequestIdsRef = useRef(new Set<string>());
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const completePendingCancellation = useCallback(() => {
    const waiters = cancelWaitersRef.current;
    cancelWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

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
    activeRequestRef.current = false;
    queueStatusRef.current = null;
    cancelRequestedRef.current = false;
    setIsStreaming(false);
    setIsQueued(false);
    callbacksRef.current.onCanceled?.(message);
  }, [markRequestTerminal]);

  const flushPendingEvents = useCallback((sid: string, rid: string) => {
    const pendingEvents = pendingEventsRef.current;
    pendingEventsRef.current = [];
    const eventSource = eventSourceRef.current;
    if (!eventSource) return;
    pendingEvents
      .filter((event) => matchesAgentRequest(event, sid, rid))
      .forEach((event) => eventSource.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event) })));
  }, []);

  const cancelSession = useCallback(async (sid: string, rid: string) => {
    try {
      await cancelAgentChat(sid, rid);
      finishCanceledRequest(rid, "已停止生成");
    } catch (error) {
      cancelRequestedRef.current = false;
      callbacksRef.current.onError?.(error instanceof Error ? error.message : "停止生成失败");
    } finally {
      setIsStopping(false);
      completePendingCancellation();
    }
  }, [completePendingCancellation, finishCanceledRequest]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectSSE = useCallback(() => {
    clearReconnectTimer();
    if (eventSourceRef.current) eventSourceRef.current.close();
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
      const queued = data.status === "queued";
      activeRequestRef.current = true;
      setIsQueued(queued);
      setIsStreaming(!queued);
      callbacksRef.current.onQueueStatus?.(data.status);
    });

    es.addEventListener("thought-delta", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onThoughtDelta?.(data.thoughtId || "", data.thoughtDelta || "");
    });

    es.addEventListener("thought-complete", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onThoughtComplete?.(data.thoughtId || "", data.thoughtDurationMs || 0);
    });

    es.addEventListener("text-delta", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onTextDelta?.(data.messageId || "", data.delta || "");
    });

    es.addEventListener("tool-execute", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      if (!data.name || !data.callId) return;
      callbacksRef.current.onToolCall?.({
        callId: data.callId,
        name: data.name,
        arguments: data.arguments || {},
        status: "executing",
        progress: 0,
      });
    });

    es.addEventListener("progress", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onToolProgress?.(
        data.callId || "",
        data.taskId || "",
        data.progress ?? 0,
        data.status || ""
      );
    });

    es.addEventListener("tool-result", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onToolResult?.(
        data.callId || "",
        Boolean(data.resultOk),
        data.resultMessage || "",
        data.resultData || undefined
      );
    });

    es.addEventListener("task-complete", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      setIsStreaming(false);
      setIsQueued(false);
      activeRequestRef.current = false;
      queueStatusRef.current = null;
      markRequestTerminal(data.requestId);
      callbacksRef.current.onTaskComplete?.(data.messageId || "", data.text || "", data.action);
    });

    es.addEventListener("canceled", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      setIsStreaming(false);
      setIsQueued(false);
      setIsStopping(false);
      completePendingCancellation();
      finishCanceledRequest(data.requestId || "", data.text || "已停止生成");
    });

    es.addEventListener("notice", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onNotice?.(data.text || "");
    });

    es.addEventListener("plan-created", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onPlanCreated?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.summary || data.text || ""),
        Number(data.resultData?.taskCount || 0),
      );
    });

    es.addEventListener("plan-task-status", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onPlanTaskStatus?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.taskId || data.callId || ""),
        data.status || "",
        String(data.resultData?.message || data.text || ""),
      );
    });

    es.addEventListener("prompt-prepared", (e: MessageEvent) => {
      const data = readCurrentEvent(e);
      if (!data) return;
      callbacksRef.current.onPromptPrepared?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.taskId || data.callId || ""),
        String(data.resultData?.strategy || "KEEP") as "KEEP" | "OPTIMIZE",
      );
    });

    es.addEventListener("error", (e: MessageEvent) => {
      if (!e.data) return;
      try {
        const data = readCurrentEvent(e);
        if (!data) return;
        const errorMessage = data.errorMessage || "未知错误";
        setIsStreaming(false);
        setIsQueued(false);
        activeRequestRef.current = false;
        queueStatusRef.current = null;
        markRequestTerminal(data.requestId);
        if (CLOSED_CONNECTION_ERROR_PATTERN.test(errorMessage)) {
          if (cancelRequestedRef.current || canceledHandledRef.current) {
            finishCanceledRequest(data.requestId || "", "已停止生成");
            return;
          }
          callbacksRef.current.onError?.("生成连接已关闭，请重新生成");
          return;
        }
        callbacksRef.current.onError?.(errorMessage);
      } catch {
        callbacksRef.current.onError?.("未知错误");
      }
    });

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
  }, [clearReconnectTimer, completePendingCancellation, finishCanceledRequest, markRequestTerminal]);

  connectSSERef.current = connectSSE;

  const sendMessage = useCallback(
    async (message: string, attachments?: AgentAttachment[], settingsOverride?: CreationSettings) => {
      if (sendingRef.current || activeRequestRef.current) return;
      sendingRef.current = true;
      activeRequestRef.current = true;
      cancelRequestedRef.current = false;
      canceledHandledRef.current = false;
      const previousSessionId = sessionIdRef.current;
      requestIdRef.current = undefined;
      pendingEventsRef.current = [];
      queueStatusRef.current = "queued";
      setRequestId(null);
      setIsStreaming(false);
      setIsQueued(true);
      try {
        const { sessionId: sid, requestId: rid, status } = await agentChat({
          sessionId: previousSessionId,
          entrySource,
          message,
          attachments,
          creationSettings: settingsOverride || creationSettings,
        });
        sessionIdRef.current = sid;
        requestIdRef.current = rid;
        setSessionId(sid);
        setRequestId(rid);
        if ((status === "queued" || status === "running") && shouldApplyAgentQueueStatus(queueStatusRef.current, status)) {
          queueStatusRef.current = status;
          setIsQueued(status === "queued");
          setIsStreaming(status === "running");
          callbacksRef.current.onQueueStatus?.(status);
        } else if (status !== "queued" && status !== "running") {
          flushPendingEvents(sid, rid);
          markRequestTerminal(rid);
          activeRequestRef.current = false;
          queueStatusRef.current = null;
          setIsStreaming(false);
          setIsQueued(false);
          setIsStopping(false);
          cancelRequestedRef.current = false;
          completePendingCancellation();
        }
        if (!isTerminalAgentRequestStatus(status)) {
          flushPendingEvents(sid, rid);
        }
        if (cancelRequestedRef.current && !isTerminalAgentRequestStatus(status)) {
          await cancelSession(sid, rid);
        }
      } catch (err) {
        pendingEventsRef.current = [];
        callbacksRef.current.onError?.(err instanceof Error ? err.message : "发送失败");
        activeRequestRef.current = false;
        queueStatusRef.current = null;
        cancelRequestedRef.current = false;
        setIsStreaming(false);
        setIsQueued(false);
        setIsStopping(false);
        completePendingCancellation();
      } finally {
        sendingRef.current = false;
      }
    },
    [entrySource, creationSettings, cancelSession, completePendingCancellation, flushPendingEvents, markRequestTerminal]
  );

  const canChangeSession = useCallback(() => !sendingRef.current && !activeRequestRef.current, []);

  const resetSession = useCallback(() => {
    if (!canChangeSession()) return false;
    sessionIdRef.current = undefined;
    requestIdRef.current = undefined;
    pendingEventsRef.current = [];
    queueStatusRef.current = null;
    activeRequestRef.current = false;
    cancelRequestedRef.current = false;
    canceledHandledRef.current = false;
    setIsStopping(false);
    setSessionId(null);
    setRequestId(null);
    setIsStreaming(false);
    setIsQueued(false);
    return true;
  }, [canChangeSession]);

  const restoreSession = useCallback((sid: string) => {
    if (!canChangeSession()) return false;
    sessionIdRef.current = sid;
    requestIdRef.current = undefined;
    pendingEventsRef.current = [];
    queueStatusRef.current = null;
    activeRequestRef.current = false;
    setSessionId(sid);
    setRequestId(null);
    return true;
  }, [canChangeSession]);

  const cancelMessage = useCallback(async () => {
    if (cancelRequestedRef.current) {
      return;
    }
    cancelRequestedRef.current = true;
    setIsStopping(true);
    const sid = sessionIdRef.current;
    const rid = requestIdRef.current;
    if (sid && rid) {
      await cancelSession(sid, rid);
      return;
    }
    if (!sendingRef.current) {
      cancelRequestedRef.current = false;
      setIsStopping(false);
      return;
    }
    await new Promise<void>((resolve) => cancelWaitersRef.current.push(resolve));
  }, [cancelSession]);

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
    };
  }, [token, clearReconnectTimer, connectSSE]);

  // 终态对账兜底：SSE连接闪断重连会丢失task-complete等终态事件，导致前端永久loading；
  // 请求进行中间歇查询服务端请求状态，发现已终态时按终态收敛本地状态。
  useEffect(() => {
    if ((!isStreaming && !isQueued) || !requestId) return;
    let cancelled = false;
    let reconcileTimer: number | undefined;
    const reconcile = async () => {
      if (cancelRequestedRef.current || !activeRequestRef.current) return;
      try {
        const result = await agentRequestStatus(requestId);
        if (cancelled || !activeRequestRef.current || !isTerminalAgentRequestStatus(result.status)) return;
        markRequestTerminal(requestId);
        activeRequestRef.current = false;
        queueStatusRef.current = null;
        cancelRequestedRef.current = false;
        setIsStreaming(false);
        setIsQueued(false);
        setIsStopping(false);
        if (result.status === "failed") {
          callbacksRef.current.onError?.(result.message || "生成失败");
        } else if (result.status === "canceled" || result.status === "interrupted") {
          callbacksRef.current.onCanceled?.(result.message || "已停止生成");
        } else {
          callbacksRef.current.onTaskComplete?.("", "", undefined);
        }
      } catch {
        // 查询失败时等待下一轮对账，不中断当前请求。
      }
    };
    void getAiTaskPollingIntervalMilliseconds()
      .then((intervalMilliseconds) => {
        if (cancelled) return;
        reconcileTimer = window.setInterval(() => void reconcile(), intervalMilliseconds);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (reconcileTimer !== undefined) window.clearInterval(reconcileTimer);
    };
  }, [isStreaming, isQueued, requestId, markRequestTerminal]);

  return { sessionId, requestId, isStreaming, isQueued, isStopping, sendMessage, cancelMessage, canChangeSession, resetSession, restoreSession };
}
