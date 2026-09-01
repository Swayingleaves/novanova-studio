import { getAiTaskInfo, saveGenerationLog, type ServerAiTask, type ServerAiTaskStatus } from "@/services/api/server";

type GenerationLogType = "image" | "video";

type GenerationTaskLog = {
    id?: string;
    rounds?: unknown;
};

type JsonRecord = Record<string, unknown>;

/**
 * 根据服务端任务状态校准遗留的等待生成记录。
 *
 * @param logType 生成记录类型
 * @param logs 当前读取到的生成记录
 * @return 校准后的生成记录
 */
export async function reconcileGenerationLogTasks<Log extends GenerationTaskLog>(logType: GenerationLogType, logs: Log[]): Promise<Log[]> {
    const taskIds = [...new Set(logs.flatMap(findPendingTaskIds))];
    if (!taskIds.length) return persistReconciledLogs(logType, logs, new Map<string, ServerAiTask>());

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
    if (!tasks.size) return logs;

    return persistReconciledLogs(logType, logs, tasks);
}

async function persistReconciledLogs<Log extends GenerationTaskLog>(logType: GenerationLogType, logs: Log[], tasks: ReadonlyMap<string, ServerAiTask>): Promise<Log[]> {
    return Promise.all(
        logs.map(async (log) => {
            const reconciled = reconcileGenerationLog(log, tasks);
            if (!reconciled.changed || !log.id) return reconciled.log;
            try {
                await saveGenerationLog(logType, withoutGenerationStatus(reconciled.log));
                return reconciled.log;
            } catch (error) {
                console.error("保存生成任务状态失败", error);
                return log;
            }
        }),
    );
}

function reconcileGenerationLog<Log extends GenerationTaskLog>(log: Log, tasks: ReadonlyMap<string, ServerAiTask>): { log: Log; changed: boolean } {
    if (!Array.isArray(log.rounds)) return { log, changed: false };

    let changed = false;
    const rounds = log.rounds.map((round) => {
        if (!isRecord(round)) return round;
        const nextRound = reconcileRound(round, tasks);
        changed ||= nextRound !== round;
        return nextRound;
    });
    if (!changed) return { log, changed: false };

    return {
        log: { ...log, rounds, generationStatus: generationStatus(rounds) } as Log,
        changed: true,
    };
}

function reconcileRound(round: JsonRecord, tasks: ReadonlyMap<string, ServerAiTask>): JsonRecord {
    const roundTaskId = text(round.taskId);
    const resultKeys = ["results", "result"] as const;
    let changed = false;
    const nextRound: JsonRecord = { ...round };

    for (const key of resultKeys) {
        const value = round[key];
        if (Array.isArray(value)) {
            const results = value.map((result) => reconcileResult(result, roundTaskId, tasks));
            if (results.some((result, index) => result !== value[index])) {
                nextRound[key] = results;
                changed = true;
            }
            continue;
        }
        const result = reconcileResult(value, roundTaskId, tasks);
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
    return task ? updatePendingResult(round, task) : updateMissingTaskResult(round);
}

function reconcileWorkflowItem(value: unknown, tasks: ReadonlyMap<string, ServerAiTask>): unknown {
    if (!isRecord(value) || !["pending", "running"].includes(text(value.status))) return value;
    const taskId = text(value.taskId);
    const task = taskId ? tasks.get(taskId) : undefined;
    if (!task) return taskId ? value : updateMissingTaskResult(value);
    return updatePendingResult(value, task);
}

function reconcileResult(value: unknown, roundTaskId: string, tasks: ReadonlyMap<string, ServerAiTask>): unknown {
    if (!isRecord(value) || text(value.status) !== "pending") return value;
    const taskId = text(value.taskId) || roundTaskId;
    const task = taskId ? tasks.get(taskId) : undefined;
    return task ? updatePendingResult(value, task) : taskId ? value : updateMissingTaskResult(value);
}

function updatePendingResult(result: JsonRecord, task: ServerAiTask): JsonRecord {
    const status = task.status;
    return {
        ...result,
        status,
        progress: status === "success" || status === "failed" || status === "canceled" ? 100 : task.progress,
        ...(status === "failed" || status === "canceled" ? { error: task.errorMessage || (status === "canceled" ? "任务已取消" : "生成失败") } : {}),
    };
}

function updateMissingTaskResult(result: JsonRecord): JsonRecord {
    return { ...result, status: "failed", progress: 100, error: "生成任务标识缺失，无法查询任务状态" };
}

function findPendingTaskIds(log: GenerationTaskLog): string[] {
    if (!Array.isArray(log.rounds)) return [];
    return log.rounds.flatMap((round) => {
        if (!isRecord(round)) return [];
        const roundTaskId = text(round.taskId);
        const results = [
            ...(Array.isArray(round.results) ? round.results : []),
            ...(round.result === undefined ? [] : [round.result]),
        ];
        const taskIds = results.flatMap((result) => isRecord(result) && text(result.status) === "pending" ? [text(result.taskId) || roundTaskId] : []);
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

function withoutGenerationStatus(log: GenerationTaskLog): JsonRecord {
    const { generationStatus: _generationStatus, generationCompletedAt: _generationCompletedAt, generationViewedAt: _generationViewedAt, ...snapshot } = log as unknown as JsonRecord;
    return snapshot;
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
