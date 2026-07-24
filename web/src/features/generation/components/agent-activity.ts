import type { AgentActivityState, AgentActivityStatus, ChatMessageItem, ToolCallState } from "@/features/chat/types";
import type { CreationThreadSection } from "@/features/generation/components/creation-workspace-types";

export type AgentActivitiesByRoundId = Record<string, AgentActivityState[]>;

const PLAN_TASK_STATUS_MAP: Record<string, AgentActivityStatus> = {
    running: "running",
    success: "success",
    failed: "failed",
    canceled: "canceled",
    skipped: "skipped",
};

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

/** 提取聊天消息中的 Agent 执行活动。 */
export function collectAgentActivities(messages: ChatMessageItem[]): AgentActivityState[] {
    return messages.flatMap((item) => (isAgentActivityState(item.detail) ? [item.detail] : []));
}

/** 按工具调用编号与结果轮次编号一致的契约，对完成活动进行分组。 */
export function groupAgentActivitiesByRoundId(roundIds: string[], activities: AgentActivityState[]): AgentActivitiesByRoundId {
    const groupedActivities: AgentActivitiesByRoundId = {};
    const planActivities = activities.filter((activity) => activity.type === "plan-created");
    for (const roundId of roundIds) {
        const toolActivityId = `tool-${roundId}`;
        if (!activities.some((activity) => activity.type === "tool-execute" && activity.id === toolActivityId)) {
            continue;
        }
        const roundActivities = activities.filter((activity) => (
            activity.type !== "plan-created"
            && (activity.id === toolActivityId || activity.id.endsWith(`-${roundId}`))
        ));
        groupedActivities[roundId] = [...planActivities, ...roundActivities];
    }
    return groupedActivities;
}

/** 将已完成的 Agent 执行活动挂到对应历史结果轮次。 */
export function attachAgentActivitiesToThreadSections(
    sections: CreationThreadSection[],
    activitiesByRoundId: AgentActivitiesByRoundId,
): CreationThreadSection[] {
    return sections.map((section) => ({
        ...section,
        rounds: section.rounds.map((round) => ({
            ...round,
            activities: activitiesByRoundId[round.id] || round.activities,
        })),
    }));
}

/** 根据服务端计划任务状态创建可展示的活动状态。 */
export function getPlanTaskActivityStatus(status: string): AgentActivityStatus | null {
    return PLAN_TASK_STATUS_MAP[status] || null;
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
        && typeof activity.title === "string"
        && typeof activity.status === "string";
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
