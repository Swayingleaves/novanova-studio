export type ChatRole = "user" | "assistant" | "system" | "tool" | "error";

export type ChatMessageItem = {
  id: string;
  role: ChatRole;
  title?: string;
  text: string;
  meta?: string;
  detail?: unknown;
  attachments?: ChatAttachment[];
};

export type ChatAttachment = {
  id: string;
  name: string;
  url: string;
  type?: string;
};

export type ThinkingBlockState = {
  id: string;
  text: string;
  durationMs: number;
  collapsed: boolean;
};

export type ToolCallState = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "executing" | "success" | "failed" | "canceled" | "noop";
  progress: number;
  taskId?: string;
  resultMessage?: string;
  resultData?: Record<string, unknown>;
};

export type AgentActivityType = "plan-created" | "plan-task-status" | "prompt-prepared" | "tool-execute";

export type AgentActivityStatus = "pending" | "running" | "success" | "failed" | "canceled" | "skipped";

export type AgentActivityState = {
  id: string;
  type: AgentActivityType;
  title: string;
  description?: string;
  status: AgentActivityStatus;
  progress?: number;
};
