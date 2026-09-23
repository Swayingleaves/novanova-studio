export type ScriptSaveSchedulerStatus = "dirty" | "saving" | "saved" | "error" | "conflict";

type SaveJob = () => Promise<void>;

type ScriptSaveSchedulerOptions = {
    delayMilliseconds: number;
    onStatusChange: (status: ScriptSaveSchedulerStatus, error?: unknown) => void;
    isConflict: (error: unknown) => boolean;
};

/** 创建按区块防抖、跨区块串行执行的剧本保存调度器。 */
export function createScriptSaveScheduler(options: ScriptSaveSchedulerOptions) {
    const pendingJobs = new Map<string, SaveJob>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let paused = false;
    let failedJob: [string, SaveJob] | null = null;
    let generation = 0;

    const clearTimer = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
    };

    const run = async () => {
        clearTimer();
        if (running || paused) return;
        const runGeneration = generation;
        running = true;
        try {
            while (pendingJobs.size && !paused && runGeneration === generation) {
                const next = pendingJobs.entries().next().value as [string, SaveJob] | undefined;
                if (!next) break;
                pendingJobs.delete(next[0]);
                options.onStatusChange("saving");
                try {
                    await next[1]();
                    if (runGeneration !== generation) return;
                    failedJob = null;
                } catch (error) {
                    if (runGeneration !== generation) return;
                    failedJob = next;
                    const conflict = options.isConflict(error);
                    paused = true;
                    options.onStatusChange(conflict ? "conflict" : "error", error);
                    return;
                }
            }
            if (runGeneration === generation) options.onStatusChange("saved");
        } finally {
            running = false;
            if (pendingJobs.size && !paused && !timer) timer = setTimeout(() => void run(), 0);
        }
    };

    return {
        schedule(key: string, job: SaveJob) {
            pendingJobs.set(key, job);
            if (failedJob?.[0] === key) failedJob = [key, job];
            // 失败或冲突已暂停时保留醒目的错误状态，直到用户明确重试。
            if (!paused) options.onStatusChange("dirty");
            clearTimer();
            if (!paused) timer = setTimeout(() => void run(), options.delayMilliseconds);
        },
        retry() {
            if (failedJob) {
                const queued = [...pendingJobs.entries()];
                const job = pendingJobs.get(failedJob[0]) ?? failedJob[1];
                pendingJobs.clear();
                pendingJobs.set(failedJob[0], job);
                queued.forEach(([key, pending]) => {
                    if (key !== failedJob?.[0]) pendingJobs.set(key, pending);
                });
            }
            paused = false;
            void run();
        },
        resume() {
            paused = false;
            failedJob = null;
            if (pendingJobs.size) void run();
        },
        reset() {
            generation += 1;
            clearTimer();
            pendingJobs.clear();
            failedJob = null;
            paused = false;
        },
    };
}
