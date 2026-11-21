
import { translateMessage as translate } from "@/features/locale/translate";
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
    get low() { return translate("generation.lowQuality"); },
    get medium() { return translate("generation.standardQuality"); },
    get high() { return translate("generation.highQuality"); },
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
        title: translate("generation.runCreativeTask"),
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
        generate_image: translate("generation.callImageGenerationTool"),
        edit_image: translate("generation.callImageEditingTool"),
        generate_video: translate("generation.callVideoGenerationTool"),
        edit_video: translate("generation.callVideoEditingTool"),
        query_history: translate("generation.creationHistory"),
        canvas_generate_image: translate("generation.callImageGenerationTool"),
        canvas_generate_video: translate("generation.callVideoGenerationTool"),
        canvas_generate_text: "调用文本生成工具",
        canvas_create_generation_flow: "创建生成工作流",
        canvas_run_generation: "执行画布生成任务",
        canvas_create_node: "创建画布节点",
        canvas_create_text_node: "创建文本节点",
        canvas_create_text_nodes: "创建文本节点",
        canvas_create_image_prompt_flow: "创建生图工作流",
        canvas_update_node: "更新画布节点",
        canvas_update_node_text: "更新节点文本",
        canvas_move_nodes: "调整节点位置",
        canvas_resize_node: "调整节点尺寸",
        canvas_delete_nodes: "删除画布节点",
        canvas_connect_nodes: "连接画布节点",
        canvas_select_nodes: "选中画布节点",
        canvas_set_viewport: "调整画布视角",
        canvas_apply_ops: "应用画布操作",
    };
    return titles[toolName] || translate("generation.callingTool", { value0: toolName });
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
        parts.push(translate("generation.s", { value0: argumentsValue.seconds }));
    }
    if (typeof argumentsValue.count === "number") {
        parts.push(translate("generation.results", { value0: argumentsValue.count }));
    }
    return parts.length ? parts.join(" / ") : undefined;
}

const NOISE_TASK_STATUS_PATTERNS = [
    /^子\s*agent\s*正在准备任务$/i,
    /^agent\s+is\s+preparing\s+the\s+task$/i,
    /^正在执行/,
    /^已完成$/,
    /^completed$/i,
];

const GENERIC_COMPLETION_SUMMARY_PATTERNS = [
    /^生成计划已完成[：:]/,
    /^generation\s+plan\s+completed/i,
    /^已完成\s*\d+\s*张图片/,
    /^正在生成/,
];

/**
 * 将执行活动列表转换为自然对话语句，并与已流式输出的正文做去重。
 * 供实时流式气泡与历史轮次共用，确保刷新前后展示风格一致。
 */
export function buildActivityDialogueLines(activities: AgentActivityState[] | undefined, existingText?: string): string[] {
    if (!activities?.length) {
        return [];
    }
    const normalizedExisting = (existingText || "").trim();
    const lines: string[] = [];

    const pushUnique = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (normalizedExisting && (normalizedExisting.includes(trimmed) || isSubstantialOverlap(normalizedExisting, trimmed))) {
            return;
        }
        if (lines.some((item) => item === trimmed || item.includes(trimmed))) {
            return;
        }
        lines.push(trimmed);
    };

    for (const activity of activities) {
        if (activity.type === "plan-created") {
            const desc = cleanPlanDescription(activity.description || "");
            if (desc) {
                pushUnique(desc);
            }
            continue;
        }
        if (activity.type === "prompt-prepared") {
            const desc = (activity.description || activity.title || "").trim();
            if (desc) {
                pushUnique(ensureSentenceEnding(desc));
            }
            continue;
        }
        if (activity.type === "tool-execute") {
            const detail = activity.description ? `（${activity.description}）` : "";
            if (activity.status === "running" || activity.status === "pending") {
                pushUnique(`正在${activity.title}${detail}…`);
            } else if (activity.status === "failed") {
                pushUnique(`${activity.title}${detail}失败。`);
            } else if (activity.status === "canceled") {
                pushUnique(`已停止${activity.title}。`);
            } else if (activity.status === "success") {
                pushUnique(`已${activity.title}${detail}。`);
            }
            continue;
        }
        if (activity.type === "plan-task-status") {
            const desc = (activity.description || "").trim();
            if (!desc || NOISE_TASK_STATUS_PATTERNS.some((pattern) => pattern.test(desc))) {
                continue;
            }
            if (activity.status === "failed" || activity.status === "canceled" || activity.status === "running") {
                pushUnique(ensureSentenceEnding(desc));
            }
        }
    }

    return lines;
}

/**
 * 将主助手文本与执行活动对话句合成为连贯的多段气泡文本。
 * 当轮次已有结构化执行活动且主文本只是服务端通用完成汇总时，优先保持活动对话行，避免完成瞬间在顶部插入冗余汇总句。
 */
export function composeDialogueText(primaryText: string | undefined, activities: AgentActivityState[] | undefined): string {
    const rawPrimary = (primaryText || "").trim();
    const isGenericSummary = Boolean(
        activities?.length
        && rawPrimary
        && GENERIC_COMPLETION_SUMMARY_PATTERNS.some((pattern) => pattern.test(rawPrimary)),
    );
    const primary = isGenericSummary ? "" : rawPrimary;
    const activityLines = buildActivityDialogueLines(activities, primary);
    if (!primary) {
        return activityLines.join("\n");
    }
    if (!activityLines.length) {
        return primary;
    }
    return `${primary}\n${activityLines.join("\n")}`;
}

function cleanPlanDescription(text: string): string {
    return text.trim().replace(/([。！？])，\s*共/g, "$1 共");
}

function ensureSentenceEnding(text: string): string {
    return /[。！？.!?…]$/.test(text) ? text : `${text}。`;
}

function isSubstantialOverlap(existing: string, candidate: string): boolean {
    const head = candidate.slice(0, Math.min(14, candidate.length));
    return head.length >= 6 && existing.includes(head);
}
