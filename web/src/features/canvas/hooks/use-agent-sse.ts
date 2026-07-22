"use client";

import { useCallback, useEffect, useRef } from "react";

import { agentChat, agentSubscribeEvents, agentSubmitToolResult, type AgentChatHistoryMessage, type AgentEvent } from "@/features/canvas/api/agent";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { resolveCanvasAgentTool } from "../utils/canvas-agent-tools";

interface UseAgentSSEProps {
  snapshot: CanvasAgentSnapshot;
  onApplyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot;
  onToolExecute?: () => void;
  onTextDelta: (messageId: string, delta: string) => void;
  onTaskComplete: (messageId: string, text: string) => void;
  onError: (message: string) => void;
}

/**
 * Agent SSE 通信 Hook。建立 SSE 长连接，处理文本增量、工具执行、任务完成和错误事件。
 * 画布写操作工具通过 onApplyOps 应用到画布，并将执行结果回传后端继续 Agent Loop。
 */
export function useAgentSSE({ snapshot, onApplyOps, onToolExecute, onTextDelta, onTaskComplete, onError }: UseAgentSSEProps) {
  const sessionIdRef = useRef<string | undefined>(undefined);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sendingRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const onApplyOpsRef = useRef(onApplyOps);
  const onToolExecuteRef = useRef(onToolExecute);
  const onTextDeltaRef = useRef(onTextDelta);
  const onTaskCompleteRef = useRef(onTaskComplete);
  const onErrorRef = useRef(onError);
  snapshotRef.current = snapshot;
  onApplyOpsRef.current = onApplyOps;
  onToolExecuteRef.current = onToolExecute;
  onTextDeltaRef.current = onTextDelta;
  onTaskCompleteRef.current = onTaskComplete;
  onErrorRef.current = onError;

  // connectSSE 不依赖任何回调引用，所有回调通过 ref 访问，保证 SSE 连接只建立一次。
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const es = agentSubscribeEvents();
    eventSourceRef.current = es;

    // 文本增量事件
    es.addEventListener("text-delta", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      if (data.messageId && data.delta) onTextDeltaRef.current(data.messageId, data.delta);
    });

    // 工具执行事件：将工具参数转为画布操作并应用，再回传结果给后端
    es.addEventListener("tool-execute", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      if (!data.name || !data.callId) return;
      const sessionId = data.sessionId || sessionIdRef.current;
      if (!sessionId) return;
      try {
        onToolExecuteRef.current?.();
        const execution = resolveCanvasAgentTool(data.name, data.arguments);
        if (!execution) throw new Error(`不支持的画布工具: ${data.name}`);
        if (execution.ops.length > 0) {
          snapshotRef.current = onApplyOpsRef.current(execution.ops);
        }
        void agentSubmitToolResult({
          sessionId,
          callId: data.callId,
          result: execution.result,
        });
      } catch (err) {
        void agentSubmitToolResult({
          sessionId,
          callId: data.callId,
          result: { ok: false, message: err instanceof Error ? err.message : "工具执行失败" },
        });
      }
    });

    // 任务完成事件
    es.addEventListener("task-complete", (e: MessageEvent) => {
      const data: AgentEvent = JSON.parse(e.data);
      if (data.messageId && data.text) onTaskCompleteRef.current(data.messageId, data.text);
    });

    // 错误事件
    es.addEventListener("error", (e: MessageEvent) => {
      // 浏览器原生 onerror 也会触发 error 监听，e.data 此时为 undefined，避免误解析
      if (!e.data) return;
      try {
        const data: AgentEvent = JSON.parse(e.data);
        onErrorRef.current(data.errorMessage || "未知错误");
      } catch {
        onErrorRef.current("未知错误");
      }
    });

    // 连接异常时自动重连
    es.onerror = () => {
      setTimeout(() => connectSSE(), 3000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 发送用户消息，携带当前画布快照、引用和选择的模型。
   * 使用 sendingRef 同步锁防止同一事件循环内重复提交（React setState 异步导致 isRunning 守卫失效）。
   */
  const sendMessage = useCallback(
    async (message: string, references?: { title: string; text: string }[], model?: string, history?: AgentChatHistoryMessage[]) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      try {
        const { sessionId } = await agentChat({
          sessionId: sessionIdRef.current,
          message,
          canvasSnapshot: snapshotRef.current as unknown as Record<string, unknown>,
          references,
          history,
          model,
        });
        sessionIdRef.current = sessionId;
      } finally {
        sendingRef.current = false;
      }
    },
    [],
  );

  /**
   * 重置后端 Agent 会话游标，用于前端新建独立对话。
   */
  const resetSession = useCallback(() => {
    sessionIdRef.current = undefined;
  }, []);

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

  return { sendMessage, resetSession };
}
