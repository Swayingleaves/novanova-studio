import type { AgentActivityState, AgentActivityStatus, ChatMessageItem, ToolCallState } from "@/features/chat/types";

const PLAN_TASK_STATUS_MAP: Record<string, AgentActivityStatus> = {
    running: "running",
    diagnosing: "running",
    adjusting: "running",
    retrying: "running",
    success: "success",
    failed: "failed",
    canceled: "canceled",
    skipped: "skipped",
};

const AGENT_ACTIVITY_TYPES = new Set(["plan-created", "plan-task-status", "prompt-prepared", "tool-execute"]);
const AGENT_ACTIVITY_STATUSES = new Set(["pending", "running", "success", "failed", "canceled", "skipped"]);

const QUALITY_LABELS: Record<string, string> = {
    low: "低质量",
    medium: "标准质量",
    high: "高质量",
};

/** 创建或覆盖同一条 Agent 执行活动，避免 SSE 重连后重复展示。 */
export function upsertAgentActivityMessage(messages: ChatMessageItem[], activity: AgentActivityState): ChatMessageItem[] {
    const message: ChatMessageItem = {
        id: activityMessageId(activity.id),
        role: "system",
        text: activity.title,
        detail: activity,
    };
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    if (messageIndex < 0) {
        return [...messages, message];
    }
    return messages.map((item, index) => (index === messageIndex ? message : item));
}

/** 更新指定 Agent 执行活动。 */
export function updateAgentActivityMessage(
    messages: ChatMessageItem[],
    activityId: string,
    changes: Partial<Omit<AgentActivityState, "id" | "type">>,
): ChatMessageItem[] {
    const messageId = activityMessageId(activityId);
    return messages.map((item) => {
        if (item.id !== messageId || !isAgentActivityState(item.detail)) {
            return item;
        }
        const activity = { ...item.detail, ...changes };
        return { ...item, text: activity.title, detail: activity };
    });
}

/** 将仍在执行的 Agent 活动统一更新为失败或停止。 */
export function finishRunningAgentActivities(
    messages: ChatMessageItem[],
    status: "failed" | "canceled",
    description: string,
): ChatMessageItem[] {
    return messages.map((item) => {
        if (!isAgentActivityState(item.detail) || item.detail.status !== "running") {
            return item;
        }
        return { ...item, detail: { ...item.detail, status, description } };
    });
}

/**
 * 在轮次完成后，根据已知活动终态补齐仍处于执行中的步骤，避免时间线残留 loading。
 */
export function finishRoundAgentActivities(messages: ChatMessageItem[], description: string): ChatMessageItem[] {
    const hasRunningActivity = messages.some((item) => isAgentActivityState(item.detail)
        && (item.detail.status === "running" || item.detail.status === "pending"));
    if (!hasRunningActivity) {
        return messages;
    }
    const statuses = messages
        .map((item) => isAgentActivityState(item.detail) ? item.detail.status : null)
        .filter((status): status is AgentActivityStatus => status !== null);
    if (statuses.includes("failed")) {
        return finishRunningAgentActivities(messages, "failed", description);
    }
    if (statuses.includes("canceled")) {
        return finishRunningAgentActivities(messages, "canceled", description);
    }
    return messages.map((item) => {
        if (!isAgentActivityState(item.detail)
                || (item.detail.status !== "running" && item.detail.status !== "pending")) {
            return item;
        }
        return { ...item, detail: { ...item.detail, status: "success", description } };
    });
}

/** 从历史记录中恢复结构合法的Agent执行活动。 */
export function normalizeAgentActivities(value: unknown): AgentActivityState[] {
    return Array.isArray(value) ? value.filter(isAgentActivityState) : [];
}

/**
 * 历史轮次已经有终态结果时，将遗留的执行中活动收尾，兼容旧数据未正确落终态的情况。
 */
export function normalizeHistoricalAgentActivities(
    value: unknown,
    terminalStatus: "success" | "failed" | "canceled" | null,
): AgentActivityState[] {
    const activities = normalizeAgentActivities(value);
    if (!terminalStatus) {
        return activities;
    }
    return activities.map((activity) => (
        activity.status === "running" || activity.status === "pending"
            ? { ...activity, status: terminalStatus }
            : activity
    ));
}

/** 根据服务端计划任务状态创建可展示的活动状态。 */
export function getPlanTaskActivityStatus(status: string): AgentActivityStatus | null {
    return PLAN_TASK_STATUS_MAP[status] || null;
}

const TERMINAL_ACTIVITY_STATUSES: ReadonlySet<AgentActivityStatus> = new Set(["success", "failed", "canceled", "skipped"]);

/**
 * 合并计划任务状态活动：活动已处于终态时忽略后到的中间运行状态（诊断/调整/重试），
 * 避免服务端 diagnosing 与终态事件乱序到达时，活动状态从失败/成功回退为执行中。
 */
export function mergePlanTaskActivityMessage(
    messages: ChatMessageItem[],
    planId: string,
    taskId: string,
    status: string,
    statusMessage: string,
): ChatMessageItem[] {
    const activityStatus = getPlanTaskActivityStatus(status);
    if (!activityStatus) {
        return messages;
    }
    const activityId = `task-${planId}-${taskId}`;
    const existing = messages.find((item) => item.id === activityMessageId(activityId));
    const existingStatus = existing && isAgentActivityState(existing.detail) ? existing.detail.status : null;
    if (existingStatus !== null && TERMINAL_ACTIVITY_STATUSES.has(existingStatus)
            && (activityStatus === "running" || activityStatus === "pending")) {
        return messages;
    }
    return upsertAgentActivityMessage(messages, {
        id: activityId,
        type: "plan-task-status",
        title: "执行创作任务",
        description: statusMessage,
        status: activityStatus,
    });
}

/** 创建工具执行活动，并提取用户可理解的关键生成参数。 */
export function createToolExecutionActivity(call: ToolCallState): AgentActivityState {
    return {
        id: `tool-${call.callId}`,
        type: "tool-execute",
        title: toolTitle(call.name),
        description: toolDescription(call.arguments),
        status: call.status === "executing" ? "running" : call.status === "noop" ? "skipped" : call.status,
        progress: call.progress,
    };
}

/** 判断消息详情是否为 Agent 执行活动。 */
export function isAgentActivityState(value: unknown): value is AgentActivityState {
    if (!value || typeof value !== "object") {
        return false;
    }
    const activity = value as Partial<AgentActivityState>;
    return typeof activity.id === "string"
        && typeof activity.type === "string"
        && AGENT_ACTIVITY_TYPES.has(activity.type)
        && typeof activity.title === "string"
        && typeof activity.status === "string"
        && AGENT_ACTIVITY_STATUSES.has(activity.status)
        && (activity.description === undefined || typeof activity.description === "string")
        && (activity.progress === undefined || typeof activity.progress === "number");
}

function activityMessageId(activityId: string): string {
    return `agent-activity-${activityId}`;
}

function toolTitle(toolName: string): string {
    const titles: Record<string, string> = {
        generate_image: "调用图片生成工具",
        edit_image: "调用图片编辑工具",
        generate_video: "调用视频生成工具",
        edit_video: "调用视频编辑工具",
        query_history: "查询历史创作",
    };
    return titles[toolName] || `调用工具：${toolName}`;
}

function toolDescription(argumentsValue: Record<string, unknown>): string | undefined {
    const parts: string[] = [];
    if (typeof argumentsValue.size === "string" && argumentsValue.size) {
        parts.push(argumentsValue.size);
    }
    if (typeof argumentsValue.resolution === "string" && argumentsValue.resolution) {
        parts.push(argumentsValue.resolution);
    }
    if (typeof argumentsValue.quality === "string" && QUALITY_LABELS[argumentsValue.quality]) {
        parts.push(QUALITY_LABELS[argumentsValue.quality]);
    }
    if (typeof argumentsValue.seconds === "string" || typeof argumentsValue.seconds === "number") {
        parts.push(`${argumentsValue.seconds} 秒`);
    }
    if (typeof argumentsValue.count === "number") {
        parts.push(`${argumentsValue.count} 个结果`);
    }
    return parts.length ? parts.join(" / ") : undefined;
}
