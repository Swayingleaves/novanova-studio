
import { translateMessage as translate } from "@/features/locale/translate";
import { getAiTaskInfo, type ServerAiTask, type ServerAiTaskStatus } from "@/services/api/server";

type GenerationLogType = "image" | "video";

type GenerationTaskLog = {
    id?: string;
    rounds?: unknown;
};

type JsonRecord = Record<string, unknown>;

/**
 * 根据服务端任务恢复等待或缺少媒体的生成记录，仅用于当前页面展示。
 *
 * @param logType 生成记录类型
 * @param logs 当前读取到的生成记录
 * @return 校准后的生成记录
 */
export async function reconcileGenerationLogTasks<Log extends GenerationTaskLog>(logType: GenerationLogType, logs: Log[]): Promise<Log[]> {
    const taskIds = [...new Set(logs.flatMap((log) => findTaskIdsToReconcile(logType, log)))];
    const tasks = new Map<string, ServerAiTask>();
    await Promise.all(
        taskIds.map(async (taskId) => {
            try {
                const task = await getAiTaskInfo(taskId);
                if (isTerminalTaskStatus(task.status)) tasks.set(taskId, task);
            } catch (error) {
                console.error("查询生成任务状态失败", error);
            }
        }),
    );
    if (taskIds.length && !tasks.size) return logs;
    // 查询与后台终态保存可能并发，不能把读取到的旧快照回写并覆盖完整媒体或其他轮次。
    return logs.map((log) => reconcileGenerationLog(logType, log, tasks));
}

function reconcileGenerationLog<Log extends GenerationTaskLog>(logType: GenerationLogType, log: Log, tasks: ReadonlyMap<string, ServerAiTask>): Log {
    if (!Array.isArray(log.rounds)) return log;

    let changed = false;
    const rounds = log.rounds.map((round) => {
        if (!isRecord(round)) return round;
        const nextRound = reconcileRound(logType, round, tasks);
        changed ||= nextRound !== round;
        return nextRound;
    });
    if (!changed) return log;

    return { ...log, rounds, generationStatus: generationStatus(rounds) } as Log;
}

function reconcileRound(logType: GenerationLogType, round: JsonRecord, tasks: ReadonlyMap<string, ServerAiTask>): JsonRecord {
    const roundTaskId = text(round.taskId);
    const resultKeys = ["results", "result"] as const;
    let changed = false;
    const nextRound: JsonRecord = { ...round };

    for (const key of resultKeys) {
        const value = round[key];
        if (Array.isArray(value)) {
            const results = value.flatMap((result) => reconcileResult(logType, result, roundTaskId, tasks));
            if (results.length !== value.length || results.some((result, index) => result !== value[index])) {
                nextRound[key] = results;
                changed = true;
            }
            continue;
        }
        const result = reconcileResult(logType, value, roundTaskId, tasks)[0];
        if (result !== value) {
            nextRound[key] = result;
            changed = true;
        }
    }

    for (const key of ["stages", "tasks"] as const) {
        const value = round[key];
        if (!Array.isArray(value)) continue;
        const nextItems = value.map((item) => reconcileWorkflowItem(item, tasks));
        if (nextItems.some((item, index) => item !== value[index])) {
            nextRound[key] = nextItems;
            changed = true;
        }
    }

    if (changed || text(round.status) !== "pending") return changed ? nextRound : round;
    const task = roundTaskId ? tasks.get(roundTaskId) : undefined;
    return task ? updatePendingResult(round, task) : roundTaskId ? round : updateMissingTaskResult(round);
}

function reconcileWorkflowItem(value: unknown, tasks: ReadonlyMap<string, ServerAiTask>): unknown {
    if (!isRecord(value) || !["pending", "running"].includes(text(value.status))) return value;
    const taskId = text(value.taskId);
    const task = taskId ? tasks.get(taskId) : undefined;
    if (!task) return taskId ? value : updateMissingTaskResult(value);
    return updatePendingResult(value, task);
}

/** 同时恢复终态与媒体，一次生成多张图片时展开全部结果，并保持结果标识稳定。 */
function reconcileResult(logType: GenerationLogType, value: unknown, roundTaskId: string, tasks: ReadonlyMap<string, ServerAiTask>): unknown[] {
    if (!needsResultReconciliation(logType, value)) return [value];
    const taskId = text(value.taskId) || roundTaskId;
    const task = taskId ? tasks.get(taskId) : undefined;
    if (!task) return [taskId ? value : updateMissingTaskResult(value)];
    const result = updatePendingResult(value, task);
    if (task.status !== "success") return [result];

    const data = isRecord(task.resultData) ? task.resultData : {};
    const candidates = Array.isArray(data.items) ? data.items : data.item === undefined ? [] : [data.item];
    const mediaItems = candidates.filter((item): item is JsonRecord => isRecord(item) && Boolean(text(item.url)));
    if (!mediaItems.length) {
        return [{ ...result, status: "failed", error: translate(logType === "image" ? "generation.imageTaskCompletedWithoutImages" : "generation.videoTaskReturnedNoResult") }];
    }
    const resultId = text(value.id) || task.id;
    return mediaItems.map((item, index) => ({
        ...result,
        id: index === 0 ? resultId : `${resultId}-${index}`,
        [logType]: {
            ...item,
            id: text(item.id) || text(item.storageKey) || `${resultId}-${index}`,
            ...(logType === "image" ? { dataUrl: text(item.url) } : {}),
        },
    }));
}

/** 已完成却没有媒体的历史结果也需查询任务，不能只检查pending。 */
function needsResultReconciliation(logType: GenerationLogType, value: unknown): value is JsonRecord {
    if (!isRecord(value)) return false;
    if (text(value.status) === "pending") return true;
    if (text(value.status) !== "success") return false;
    const media = value[logType];
    return !isRecord(media) || ![media.url, media.storageKey, ...(logType === "image" ? [media.dataUrl] : [])].some((value) => Boolean(text(value)));
}

function updatePendingResult(result: JsonRecord, task: ServerAiTask): JsonRecord {
    const status = task.status;
    return {
        ...result,
        status,
        progress: status === "success" || status === "failed" || status === "canceled" ? 100 : task.progress,
        ...(status === "failed" || status === "canceled" ? { error: task.errorMessage || (status === "canceled" ? translate("generation.taskCanceled") : translate("generation.generationFailed")) } : {}),
    };
}

function updateMissingTaskResult(result: JsonRecord): JsonRecord {
    return { ...result, status: "failed", progress: 100, error: translate("generation.missingGenerationTaskID") };
}

function findTaskIdsToReconcile(logType: GenerationLogType, log: GenerationTaskLog): string[] {
    if (!Array.isArray(log.rounds)) return [];
    return log.rounds.flatMap((round) => {
        if (!isRecord(round)) return [];
        const roundTaskId = text(round.taskId);
        const results = [
            ...(Array.isArray(round.results) ? round.results : []),
            ...(round.result === undefined ? [] : [round.result]),
        ];
        const taskIds = results.flatMap((result) => needsResultReconciliation(logType, result) ? [text(result.taskId) || roundTaskId] : []);
        const workflowTaskIds = ["stages", "tasks"].flatMap((key) => Array.isArray(round[key])
            ? round[key].flatMap((item) => isRecord(item) && ["pending", "running"].includes(text(item.status)) && text(item.taskId) ? [text(item.taskId)] : [])
            : []);
        return [...taskIds.filter(Boolean), ...workflowTaskIds].length
            ? [...taskIds.filter(Boolean), ...workflowTaskIds]
            : text(round.status) === "pending" && roundTaskId ? [roundTaskId] : [];
    });
}

function generationStatus(rounds: unknown[]): "idle" | "running" | "success" | "failed" {
    const statuses = rounds.flatMap(roundStatuses);
    if (!statuses.length) return "idle";
    if (statuses.includes("pending")) return "running";
    const latestStatuses = roundStatuses(rounds.at(-1));
    return latestStatuses.includes("success") ? "success" : "failed";
}

function roundStatuses(round: unknown): string[] {
    if (!isRecord(round)) return [];
    const results = [
        ...(Array.isArray(round.results) ? round.results : []),
        ...(round.result === undefined ? [] : [round.result]),
    ];
    const statuses = results.flatMap((result) => isRecord(result) ? [text(result.status)] : []).filter(Boolean);
    const workflowStatuses = ["stages", "tasks"].flatMap((key) => Array.isArray(round[key]) ? round[key].flatMap((item) => isRecord(item) ? [text(item.status)] : []).filter(Boolean) : []);
    statuses.push(...workflowStatuses);
    return statuses.length ? statuses : [text(round.status)].filter(Boolean);
}

function isTerminalTaskStatus(status: ServerAiTaskStatus): boolean {
    return status === "success" || status === "failed" || status === "canceled";
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}
