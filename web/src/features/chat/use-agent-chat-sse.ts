"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAction, AgentAttachment, AgentEvent, CreationSettings } from "@/features/canvas/api/agent";
import { agentChat, agentSubscribeEvents, cancelAgentChat } from "@/features/canvas/api/agent";
import { useUserStore } from "@/features/auth/stores/use-user-store";
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
  onError?: (error: string) => void;
};

type AgentChatSSEReturn = {
  sessionId: string | null;
  isStreaming: boolean;
  isStopping: boolean;
  sendMessage: (message: string, attachments?: AgentAttachment[], creationSettings?: CreationSettings) => Promise<void>;
  cancelMessage: () => Promise<void>;
  resetSession: () => void;
  restoreSession: (sid: string) => void;
};

/**
 * 通用 Agent SSE 通信 Hook，支持画布、图片和视频三类入口来源。
 * 图片与视频入口下后端自行执行工具，前端透传事件给回调。
 */
export function useAgentChatSSE(props: UseAgentChatSSEProps): AgentChatSSEReturn {
  const { entrySource, creationSettings } = props;

  const sessionIdRef = useRef<string | undefined>();
  const eventSourceRef = useRef<EventSource | null>(null);
  const sendingRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const canceledHandledRef = useRef(false);
  const cancelWaitersRef = useRef<Array<() => void>>([]);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const completePendingCancellation = useCallback(() => {
    const waiters = cancelWaitersRef.current;
    cancelWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  const cancelSession = useCallback(async (sid: string) => {
    try {
      await cancelAgentChat(sid);
      setIsStreaming(false);
    } catch (error) {
      cancelRequestedRef.current = false;
      callbacksRef.current.onError?.(error instanceof Error ? error.message : "停止生成失败");
    } finally {
      setIsStopping(false);
      completePendingCancellation();
    }
  }, [completePendingCancellation]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = agentSubscribeEvents();
    eventSourceRef.current = es;

    es.addEventListener("thought-delta", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onThoughtDelta?.(data.thoughtId || "", data.thoughtDelta || "");
    });

    es.addEventListener("thought-complete", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onThoughtComplete?.(data.thoughtId || "", data.thoughtDurationMs || 0);
    });

    es.addEventListener("text-delta", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onTextDelta?.(data.messageId || "", data.delta || "");
    });

    es.addEventListener("tool-execute", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
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
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onToolProgress?.(
        data.callId || "",
        data.taskId || "",
        data.progress ?? 0,
        data.status || ""
      );
    });

    es.addEventListener("tool-result", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onToolResult?.(
        data.callId || "",
        Boolean(data.resultOk),
        data.resultMessage || "",
        data.resultData || undefined
      );
    });

    es.addEventListener("task-complete", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      setIsStreaming(false);
      callbacksRef.current.onTaskComplete?.(data.messageId || "", data.text || "", data.action);
    });

    es.addEventListener("canceled", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      setIsStreaming(false);
      setIsStopping(false);
      cancelRequestedRef.current = false;
      completePendingCancellation();
      if (!canceledHandledRef.current) {
        canceledHandledRef.current = true;
        callbacksRef.current.onCanceled?.(data.text || "已停止生成");
      }
    });

    es.addEventListener("notice", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onNotice?.(data.text || "");
    });

    es.addEventListener("plan-created", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onPlanCreated?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.summary || data.text || ""),
        Number(data.resultData?.taskCount || 0),
      );
    });

    es.addEventListener("plan-task-status", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onPlanTaskStatus?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.taskId || data.callId || ""),
        data.status || "",
        String(data.resultData?.message || data.text || ""),
      );
    });

    es.addEventListener("prompt-prepared", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      callbacksRef.current.onPromptPrepared?.(
        String(data.resultData?.planId || ""),
        String(data.resultData?.taskId || data.callId || ""),
        String(data.resultData?.strategy || "KEEP") as "KEEP" | "OPTIMIZE",
      );
    });

    es.addEventListener("error", (e: MessageEvent) => {
      if (!e.data) return;
      try {
        const data: AgentEvent = JSON.parse(e.data);
        const errorMessage = data.errorMessage || "未知错误";
        setIsStreaming(false);
        if (CLOSED_CONNECTION_ERROR_PATTERN.test(errorMessage)) {
          if (cancelRequestedRef.current || canceledHandledRef.current) {
            if (!canceledHandledRef.current) {
              canceledHandledRef.current = true;
              callbacksRef.current.onCanceled?.("已停止生成");
            }
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

    es.onerror = () => {
      setTimeout(() => connectSSE(), 3000);
    };
  }, []);

  const sendMessage = useCallback(
    async (message: string, attachments?: AgentAttachment[], settingsOverride?: CreationSettings) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      canceledHandledRef.current = false;
      setIsStreaming(true);
      try {
        const { sessionId: sid } = await agentChat({
          sessionId: sessionIdRef.current,
          entrySource,
          message,
          attachments,
          creationSettings: settingsOverride || creationSettings,
        });
        sessionIdRef.current = sid;
        setSessionId(sid);
        if (cancelRequestedRef.current) {
          await cancelSession(sid);
        }
      } catch (err) {
        callbacksRef.current.onError?.(err instanceof Error ? err.message : "发送失败");
        setIsStreaming(false);
      } finally {
        sendingRef.current = false;
      }
    },
    [entrySource, creationSettings]
  );

  const resetSession = useCallback(() => {
    sessionIdRef.current = undefined;
    cancelRequestedRef.current = false;
    canceledHandledRef.current = false;
    setIsStopping(false);
    setSessionId(null);
  }, []);

  const restoreSession = useCallback((sid: string) => {
    sessionIdRef.current = sid;
    setSessionId(sid);
  }, []);

  const cancelMessage = useCallback(async () => {
    if (cancelRequestedRef.current) {
      return;
    }
    cancelRequestedRef.current = true;
    setIsStopping(true);
    const sid = sessionIdRef.current;
    if (sid) {
      await cancelSession(sid);
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
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }
    connectSSE();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [token, connectSSE]);

  return { sessionId, isStreaming, isStopping, sendMessage, cancelMessage, resetSession, restoreSession };
}
