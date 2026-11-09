"use client";
import { notifyInsufficientCredits, useInsufficientCreditsStore } from "@/features/credits/insufficient-credits";
import { useTranslation } from "@/features/locale/use-translation";


import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import type { AgentAction, AgentAttachment, AgentEvent, CreationSettings } from "@/features/canvas/api/agent";
import { agentChat, agentRequestStatus, agentSubscribeEvents, cancelAgentChat } from "@/features/canvas/api/agent";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { getAiTaskPollingIntervalMilliseconds, isProviderRequestAlreadySentError } from "@/services/api/server";
import { isTerminalAgentRequestStatus, matchesAgentRequest, shouldApplyAgentQueueStatus, type AgentQueueStatus } from "./agent-event-match";
import type { ToolCallState } from "./types";

const CLOSED_CONNECTION_ERROR_PATTERN = /(?:java\.io\.IOException:\s*)?closed\b/i;
const LIVE_EVENT_TYPES = ["queue-status", "thought-delta", "thought-complete", "text-delta", "tool-execute", "progress", "tool-result", "task-complete", "canceled", "notice", "plan-created", "plan-task-status", "prompt-prepared"];

type UseAgentChatSSEProps = {
  entrySource: "imagePage" | "videoPage" | "canvas";
  creationSettings?: CreationSettings;
  skillId?: string;
  /** 对话模式：agent 由主 Agent 规划优化，chat 跳过规划直接生成。 */
  mode?: "agent" | "chat";
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
  /** 任一会话请求被接受或结束时通知页面刷新会话列表。 */
  onRequestActivity?: (sessionId: string) => void;
};

type AgentChatSSEReturn = {
  sessionId: string | null;
  requestId: string | null;
  isStreaming: boolean;
  isQueued: boolean;
  isStopping: boolean;
  sendMessage: (message: string, attachments?: AgentAttachment[], creationSettings?: CreationSettings, skillIdOverride?: string) => Promise<void>;
  cancelMessage: (forfeitSubmittedGeneration?: boolean) => Promise<void>;
  /** 指定会话是否仍有未结束的本页请求。 */
  isSessionBusy: (sessionId?: string | null) => boolean;
  /** 当前页面是否还有任一未结束请求。 */
  hasInflightWork: () => boolean;
  resetSession: () => boolean;
  restoreSession: (sid: string) => boolean;
};

type InflightRequest = {
  key: string;
  sessionId?: string;
  requestId?: string;
  phase: "sending" | "queued" | "running";
  stopping: boolean;
  cancelRequested: boolean;
  settled: boolean;
  queueStatus: AgentQueueStatus | null;
  cancelWaiters: Array<() => void>;
  cancelError?: unknown;
};

let draftSequence = 0;

/**
 * 通用 Agent SSE 通信 Hook，支持画布、图片和视频三类入口来源。
 * 图片与视频入口可以同时跟踪多个会话请求；实时聊天事件只写入当前正在查看的会话。
 */
export function useAgentChatSSE(props: UseAgentChatSSEProps): AgentChatSSEReturn {
    const translate = useTranslation();
  const locale = useLocale();
  const subscribedLocale = useRef(locale);
  const { entrySource, creationSettings, skillId, mode } = props;

  const viewedSessionIdRef = useRef<string | null>(null);
  const focusKeyRef = useRef<string | null>(null);
  const liveEventsRef = useRef(true);
  const inflightRef = useRef<Map<string, InflightRequest>>(new Map());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseEnabledRef = useRef(false);
  const connectSSERef = useRef<() => void>(() => undefined);
  const pendingEventsRef = useRef<AgentEvent[]>([]);
  const terminalRequestIdsRef = useRef(new Set<string>());
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const runtimeRef = useRef({
    readEvent: (_event: MessageEvent): AgentEvent | null => null,
    handleAgentEvent: (_data: AgentEvent) => undefined,
  });

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [trackedRequestIds, setTrackedRequestIds] = useState<string[]>([]);

  const syncTrackedRequestIds = useCallback(() => {
    const ids = [...inflightRef.current.values()].flatMap((item) => (item.requestId ? [item.requestId] : [])).sort();
    setTrackedRequestIds((current) => (current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids));
  }, []);

  const presentFocus = useCallback(() => {
    const item = focusKeyRef.current ? inflightRef.current.get(focusKeyRef.current) : undefined;
    setIsStreaming(item?.phase === "running");
    setIsQueued(Boolean(item && (item.phase === "sending" || item.phase === "queued")));
    setIsStopping(Boolean(item?.stopping));
    setRequestId(item?.requestId ?? null);
  }, []);

  const resolveWaiters = useCallback((item: InflightRequest) => {
    const waiters = item.cancelWaiters;
    item.cancelWaiters = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  const showLive = useCallback((item: InflightRequest) => liveEventsRef.current && focusKeyRef.current === item.key, []);

  const notifyActivity = useCallback((sessionIdToNotify?: string) => {
    if (sessionIdToNotify) callbacksRef.current.onRequestActivity?.(sessionIdToNotify);
  }, []);

  const markRequestTerminal = useCallback((requestIdToMark?: string) => {
    if (!requestIdToMark) return;
    const terminalRequestIds = terminalRequestIdsRef.current;
    if (terminalRequestIds.size >= 128) {
      const oldestRequestId = terminalRequestIds.values().next().value;
      if (oldestRequestId) terminalRequestIds.delete(oldestRequestId);
    }
    terminalRequestIds.add(requestIdToMark);
  }, []);

  const beginSettle = useCallback((item: InflightRequest) => {
    if (item.settled) return false;
    item.settled = true;
    item.stopping = false;
    inflightRef.current.delete(item.key);
    markRequestTerminal(item.requestId);
    if (focusKeyRef.current === item.key) {
      setIsStreaming(false);
      setIsQueued(false);
      setIsStopping(false);
    }
    resolveWaiters(item);
    syncTrackedRequestIds();
    return true;
  }, [markRequestTerminal, resolveWaiters, syncTrackedRequestIds]);

  const bindIdentity = useCallback((item: InflightRequest, nextSessionId: string, nextRequestId: string) => {
    const previousKey = item.key;
    item.sessionId = nextSessionId;
    item.requestId = nextRequestId;
    if (previousKey !== nextSessionId) {
      inflightRef.current.delete(previousKey);
      item.key = nextSessionId;
      inflightRef.current.set(nextSessionId, item);
      if (focusKeyRef.current === previousKey) {
        focusKeyRef.current = nextSessionId;
        viewedSessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
      }
    }
    if (focusKeyRef.current === item.key) setRequestId(nextRequestId);
    syncTrackedRequestIds();
  }, [syncTrackedRequestIds]);

  const applyQueueStatus = useCallback((item: InflightRequest, status: AgentQueueStatus) => {
    if (item.cancelRequested || item.settled) return;
    if (!shouldApplyAgentQueueStatus(item.queueStatus, status)) return;
    const becameRunning = status === "running" && item.queueStatus !== "running";
    item.queueStatus = status;
    item.phase = status;
    if (becameRunning) notifyActivity(item.sessionId);
    if (focusKeyRef.current !== item.key) return;
    setIsQueued(status === "queued");
    setIsStreaming(status === "running");
    if (liveEventsRef.current) callbacksRef.current.onQueueStatus?.(status);
  }, [notifyActivity]);

  const findByEvent = useCallback((event: AgentEvent) => {
    for (const item of inflightRef.current.values()) {
      if (matchesAgentRequest(event, item.sessionId, item.requestId)) return item;
    }
    return undefined;
  }, []);

  const hasUnresolvedSend = useCallback(() => [...inflightRef.current.values()].some((item) => item.phase === "sending" && !item.requestId), []);

  const focusOn = useCallback((key: string | null, nextSessionId: string | null) => {
    focusKeyRef.current = key;
    viewedSessionIdRef.current = nextSessionId;
    presentFocus();
    setSessionId(nextSessionId);
  }, [presentFocus]);

  const cancelInflight = useCallback(async (item: InflightRequest, forfeitSubmittedGeneration = false) => {
    if (!item.sessionId || !item.requestId || item.settled) return;
    const sessionToCancel = item.sessionId;
    const requestToCancel = item.requestId;
    try {
      await cancelAgentChat(sessionToCancel, requestToCancel, forfeitSubmittedGeneration);
      const live = showLive(item);
      if (!beginSettle(item)) return;
      notifyActivity(item.sessionId);
      if (live) callbacksRef.current.onCanceled?.(translate("chat.generationStopped"));
    } catch (error) {
      item.cancelRequested = false;
      item.stopping = false;
      item.cancelError = error;
      if (focusKeyRef.current === item.key) setIsStopping(false);
      if (isProviderRequestAlreadySentError(error)) throw error;
      if (showLive(item)) callbacksRef.current.onError?.(error instanceof Error ? error.message : translate("chat.failedToStopGeneration"));
    } finally {
      item.stopping = false;
      if (focusKeyRef.current === item.key) setIsStopping(false);
      resolveWaiters(item);
    }
  }, [beginSettle, notifyActivity, resolveWaiters, showLive]);

  const settleFromStatus = useCallback((item: InflightRequest, status: string, message: string) => {
    const live = showLive(item);
    if (!beginSettle(item)) return;
    notifyActivity(item.sessionId);
    if (!live) return;
    if (status === "failed") callbacksRef.current.onError?.(message || translate("chat.generationFailed"));
    else if (status === "canceled" || status === "interrupted") callbacksRef.current.onCanceled?.(message || translate("chat.generationStopped"));
    else callbacksRef.current.onTaskComplete?.("", "", undefined);
  }, [beginSettle, notifyActivity, showLive]);

  runtimeRef.current = {
    readEvent: (event: MessageEvent): AgentEvent | null => {
      try {
        const data: AgentEvent = JSON.parse(event.data);
        if (data.requestId && terminalRequestIdsRef.current.has(data.requestId)) return null;
        if (findByEvent(data)) return data;
        if (data.requestId && hasUnresolvedSend()) {
          const pendingEvents = pendingEventsRef.current;
          if (pendingEvents.length >= 256) pendingEvents.shift();
          pendingEvents.push(data);
        }
        return null;
      } catch {
        return null;
      }
    },
    handleAgentEvent: (data: AgentEvent) => {
      const item = findByEvent(data);
      if (!item || item.settled) return;
      const live = () => showLive(item);
      switch (data.type) {
        case "queue-status":
          if (data.status === "queued" || data.status === "running") applyQueueStatus(item, data.status);
          return;
        case "thought-delta":
          if (live()) callbacksRef.current.onThoughtDelta?.(data.thoughtId || "", data.thoughtDelta || "");
          return;
        case "thought-complete":
          if (live()) callbacksRef.current.onThoughtComplete?.(data.thoughtId || "", data.thoughtDurationMs || 0);
          return;
        case "text-delta":
          if (live()) callbacksRef.current.onTextDelta?.(data.messageId || "", data.delta || "");
          return;
        case "tool-execute":
          notifyActivity(item.sessionId);
          if (!data.name || !data.callId || !live()) return;
          callbacksRef.current.onToolCall?.({ callId: data.callId, name: data.name, arguments: data.arguments || {}, status: "executing", progress: 0 });
          return;
        case "progress":
          if (live()) callbacksRef.current.onToolProgress?.(data.callId || "", data.taskId || "", data.progress ?? 0, data.status || "");
          return;
        case "tool-result":
          notifyActivity(item.sessionId);
          if (live()) callbacksRef.current.onToolResult?.(data.callId || "", Boolean(data.resultOk), data.resultMessage || "", data.resultData || undefined);
          return;
        case "task-complete":
          if (!beginSettle(item)) return;
          notifyActivity(item.sessionId);
          if (live()) callbacksRef.current.onTaskComplete?.(data.messageId || "", data.text || "", data.action);
          return;
        case "canceled":
          if (!beginSettle(item)) return;
          notifyActivity(item.sessionId);
          if (live()) callbacksRef.current.onCanceled?.(data.text || translate("chat.generationStopped"));
          return;
        case "notice":
          if (live()) callbacksRef.current.onNotice?.(data.text || "");
          return;
        case "plan-created":
          if (!live()) return;
          callbacksRef.current.onPlanCreated?.(String(data.resultData?.planId || ""), String(data.resultData?.summary || data.text || ""), Number(data.resultData?.taskCount || 0));
          return;
        case "plan-task-status":
          if (!live()) return;
          callbacksRef.current.onPlanTaskStatus?.(String(data.resultData?.planId || ""), String(data.resultData?.taskId || data.callId || ""), data.status || "", String(data.resultData?.message || data.text || ""));
          return;
        case "prompt-prepared":
          if (!live()) return;
          callbacksRef.current.onPromptPrepared?.(String(data.resultData?.planId || ""), String(data.resultData?.taskId || data.callId || ""), String(data.resultData?.strategy || "KEEP") as "KEEP" | "OPTIMIZE");
          return;
        case "error": {
          notifyInsufficientCredits(data.systemMessage?.key, data.errorMessage, data.requestId ? `agent:${data.requestId}` : undefined, useInsufficientCreditsStore.getState().scope);
          const errorMessage = data.errorMessage || translate("chat.unknownError");
          const deliver = live();
          if (CLOSED_CONNECTION_ERROR_PATTERN.test(errorMessage)) {
            if (item.cancelRequested) {
              if (!beginSettle(item)) return;
              notifyActivity(item.sessionId);
              if (deliver) callbacksRef.current.onCanceled?.(translate("chat.generationStopped"));
              return;
            }
            if (!beginSettle(item)) return;
            notifyActivity(item.sessionId);
            if (deliver) callbacksRef.current.onError?.(translate("chat.generationConnectionClosedGenerateAgain"));
            return;
          }
          if (!beginSettle(item)) return;
          notifyActivity(item.sessionId);
          if (deliver) callbacksRef.current.onError?.(errorMessage);
          return;
        }
        default:
          return;
      }
    },
  };

  const flushPending = useCallback((nextSessionId: string, nextRequestId: string) => {
    const rest: AgentEvent[] = [];
    for (const event of pendingEventsRef.current) {
      if (event.sessionId === nextSessionId && event.requestId === nextRequestId) runtimeRef.current.handleAgentEvent(event);
      else rest.push(event);
    }
    pendingEventsRef.current = rest;
  }, []);

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
    const listen = (type: string) => {
      es.addEventListener(type, (event: Event) => {
        const message = event as MessageEvent;
        if (!message.data) return;
        const data = runtimeRef.current.readEvent(message);
        if (data) runtimeRef.current.handleAgentEvent(data);
      });
    };
    for (const type of LIVE_EVENT_TYPES) listen(type);
    es.addEventListener("error", (event: Event) => {
      const message = event as MessageEvent;
      if (!message.data) return;
      const data = runtimeRef.current.readEvent(message);
      if (data) runtimeRef.current.handleAgentEvent({ ...data, type: "error" });
    });
    es.onerror = (event) => {
      if (event instanceof MessageEvent && event.data) return;
      if (!sseEnabledRef.current || eventSourceRef.current !== es || reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (sseEnabledRef.current && eventSourceRef.current === es) connectSSERef.current();
      }, 3000);
    };
  }, [clearReconnectTimer]);

  connectSSERef.current = connectSSE;

  const sendMessage = useCallback(async (message: string, attachments?: AgentAttachment[], settingsOverride?: CreationSettings, skillIdOverride?: string) => {
    const current = focusKeyRef.current ? inflightRef.current.get(focusKeyRef.current) : undefined;
    if (current && !current.settled) return;
    const nextSessionId = viewedSessionIdRef.current ?? undefined;
    const key = nextSessionId ?? `draft:${Date.now().toString(36)}:${draftSequence += 1}`;
    const item: InflightRequest = {
      key,
      sessionId: nextSessionId,
      phase: "sending",
      stopping: false,
      cancelRequested: false,
      settled: false,
      queueStatus: "queued",
      cancelWaiters: [],
    };
    inflightRef.current.set(key, item);
    liveEventsRef.current = true;
    focusOn(key, nextSessionId ?? null);
    setIsQueued(true);
    setIsStreaming(false);
    try {
      const { sessionId: sid, requestId: rid, status } = await agentChat({
        sessionId: nextSessionId,
        entrySource,
        message,
        mode,
        attachments,
        creationSettings: settingsOverride || creationSettings,
        skillId: skillIdOverride ?? skillId,
      });
      if (item.settled) return;
      bindIdentity(item, sid, rid);
      notifyActivity(sid);
      if ((status === "queued" || status === "running") && shouldApplyAgentQueueStatus(item.queueStatus, status)) {
        applyQueueStatus(item, status);
      }
      flushPending(sid, rid);
      if (isTerminalAgentRequestStatus(status)) {
        if (!item.settled && beginSettle(item)) notifyActivity(sid);
        return;
      }
      if (item.cancelRequested) {
        try {
          await cancelInflight(item);
        } catch (error) {
          if (!isProviderRequestAlreadySentError(error)) throw error;
        }
      }
    } catch (err) {
      if (![...inflightRef.current.values()].some((candidate) => candidate !== item && candidate.phase === "sending" && !candidate.requestId)) {
        pendingEventsRef.current = [];
      }
      const live = showLive(item);
      if (beginSettle(item)) {
        notifyActivity(item.sessionId);
        if (live) callbacksRef.current.onError?.(err instanceof Error ? err.message : translate("chat.failedToSend"));
      }
    }
  }, [applyQueueStatus, beginSettle, bindIdentity, cancelInflight, creationSettings, entrySource, flushPending, focusOn, mode, notifyActivity, showLive, skillId]);

  const isSessionBusy = useCallback((sessionIdToCheck?: string | null) => {
    if (!sessionIdToCheck) return false;
    const item = inflightRef.current.get(sessionIdToCheck);
    return Boolean(item && !item.settled);
  }, []);

  const hasInflightWork = useCallback(() => inflightRef.current.size > 0, []);

  const resetSession = useCallback(() => {
    liveEventsRef.current = true;
    focusOn(null, null);
    return true;
  }, [focusOn]);

  const restoreSession = useCallback((sid: string) => {
    liveEventsRef.current = false;
    focusOn(sid, sid);
    return true;
  }, [focusOn]);

  const cancelMessage = useCallback(async (forfeitSubmittedGeneration = false) => {
    const item = focusKeyRef.current ? inflightRef.current.get(focusKeyRef.current) : undefined;
    if (!item || item.settled || (item.cancelRequested && !forfeitSubmittedGeneration)) return;
    item.cancelRequested = true;
    item.cancelError = undefined;
    item.stopping = true;
    if (focusKeyRef.current === item.key) setIsStopping(true);
    if (item.sessionId && item.requestId) {
      await cancelInflight(item, forfeitSubmittedGeneration);
      return;
    }
    if (item.phase !== "sending") {
      item.cancelRequested = false;
      item.stopping = false;
      setIsStopping(false);
      return;
    }
    await new Promise<void>((resolve) => item.cancelWaiters.push(resolve));
    if (isProviderRequestAlreadySentError(item.cancelError)) throw item.cancelError;
  }, [cancelInflight]);

  const token = useUserStore((s) => s.token);

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

  useEffect(() => {
    if (subscribedLocale.current === locale) return;
    subscribedLocale.current = locale;
    if (sseEnabledRef.current) connectSSERef.current();
  }, [locale]);

  const reconcileRef = useRef<(requestIdToCheck: string) => Promise<void>>(async () => undefined);
  reconcileRef.current = async (requestIdToCheck: string) => {
    const item = [...inflightRef.current.values()].find((candidate) => candidate.requestId === requestIdToCheck);
    if (!item || item.cancelRequested || item.settled) return;
    try {
      const result = await agentRequestStatus(requestIdToCheck);
      const current = [...inflightRef.current.values()].find((candidate) => candidate.requestId === requestIdToCheck);
      if (!current || current.settled || current.cancelRequested) return;
      if (result.status === "queued" || result.status === "running") {
        applyQueueStatus(current, result.status);
        return;
      }
      if (!isTerminalAgentRequestStatus(result.status)) return;
      settleFromStatus(current, result.status, result.message);
    } catch {
      // 查询失败时等待下一轮对账，不中断当前请求。
    }
  };

  useEffect(() => {
    if (!trackedRequestIds.length) return;
    let cancelled = false;
    let reconcileTimer: number | undefined;
    const reconcile = () => {
      if (cancelled) return;
      void Promise.all(trackedRequestIds.map((id) => reconcileRef.current(id)));
    };
    void getAiTaskPollingIntervalMilliseconds()
      .then((intervalMilliseconds) => {
        if (cancelled) return;
        reconcileTimer = window.setInterval(reconcile, intervalMilliseconds);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (reconcileTimer !== undefined) window.clearInterval(reconcileTimer);
    };
  }, [trackedRequestIds]);

  return { sessionId, requestId, isStreaming, isQueued, isStopping, sendMessage, cancelMessage, isSessionBusy, hasInflightWork, resetSession, restoreSession };
}
