export type ScriptSaveSchedulerStatus = "dirty" | "saving" | "saved" | "error" | "conflict";

type SaveJob = () => Promise<void>;

type ScriptSaveSchedulerOptions = {
    onStatusChange: (status: ScriptSaveSchedulerStatus, error?: unknown) => void;
    isConflict: (error: unknown) => boolean;
};

/**
 * 创建剧本保存队列：**只标记脏，显式调用 flush 才发请求**。
 *
 * 与旧版的差别是这里没有防抖计时器——`schedule` 只把任务塞进队列并把状态置为 dirty，
 * 真正的网络请求必须由用户点「保存」（flush）或离开前确认（flush）触发。
 * 这样拖动关系图节点、连续输入文本都不会产生请求风暴，
 * 而 530 个人物全量 upsert 这种重操作只会在用户明确要求时发生一次。
 */
export function createScriptSaveScheduler(options: ScriptSaveSchedulerOptions) {
    const pendingJobs = new Map<string, SaveJob>();
    let running = false;
    let paused = false;
    let failedJob: [string, SaveJob] | null = null;
    let generation = 0;

    const run = async () => {
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
            // generation 变了说明期间发生过 reset，旧循环不能再去动 running，否则会放走新循环的占用
            if (runGeneration === generation) running = false;
        }
    };

    return {
        /** 登记一个待保存区块。**不会发起请求**，只把状态置为 dirty 等用户手动保存。 */
        schedule(key: string, job: SaveJob) {
            pendingJobs.set(key, job);
            if (failedJob?.[0] === key) failedJob = [key, job];
            // 失败或冲突已暂停时保留醒目的错误状态，直到用户明确重试。
            if (!paused) options.onStatusChange("dirty");
        },
        /** 是否有未保存内容。用于离开页面时判断要不要提示。 */
        hasPending() {
            return pendingJobs.size > 0;
        },
        /** 执行队列中所有待保存内容。返回是否成功（失败或冲突时为 false）。 */
        async flush() {
            paused = false;
            await run();
            return !paused;
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
        /**
         * 重载项目后解除暂停并丢弃失败记录。
         * 刻意**不**自动执行队列：重载意味着以云端内容为准，页面里的旧编辑已被丢弃。
         */
        resume() {
            paused = false;
            failedJob = null;
            pendingJobs.clear();
        },
        reset() {
            generation += 1;
            pendingJobs.clear();
            failedJob = null;
            paused = false;
            // generation 变了，正在 await 的旧循环会在 finally 里跳过 running 赋值，所以这里必须手动放开，
            // 否则旧循环退出后 running 会永远卡在 true，之后所有 flush 都会被静默跳过
            running = false;
        },
    };
}
