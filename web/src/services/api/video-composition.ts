import { getAiTaskPollingIntervalMilliseconds, serverPost, type ServerMediaInfo } from "./server";

/** 视频合成任务状态。 */
export type VideoCompositionTaskStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

/** 视频合成结果媒体。 */
export type VideoCompositionResultData = Partial<ServerMediaInfo>;

/** 服务端视频合成任务。 */
export type VideoCompositionTask = {
    id: string;
    status: VideoCompositionTaskStatus;
    progress: number;
    sourceStorageKeys: string[];
    resultData: VideoCompositionResultData;
    errorMessage?: string;
    startedAt?: string;
    completedAt?: string;
    createdAt?: string;
    updatedAt?: string;
};

/**
 * 创建视频合成任务。
 *
 * @param sourceStorageKeys 按成片顺序排列的已持久化视频媒体键
 * @return 创建后的任务
 */
export function composeVideo(sourceStorageKeys: string[]): Promise<VideoCompositionTask> {
    return serverPost<VideoCompositionTask>("/ai/video/composeVideo", { sourceStorageKeys });
}

/**
 * 查询视频合成任务。
 *
 * @param taskId 任务ID
 * @return 当前任务状态
 */
export function getCompositionTask(taskId: string): Promise<VideoCompositionTask> {
    return serverPost<VideoCompositionTask>("/ai/video/getCompositionTask", { taskId });
}

/**
 * 取消视频合成任务。
 *
 * @param taskId 任务ID
 * @return 取消后的任务状态
 */
export function cancelCompositionTask(taskId: string): Promise<VideoCompositionTask> {
    return serverPost<VideoCompositionTask>("/ai/video/cancelCompositionTask", { taskId });
}

/**
 * 轮询视频合成任务直到结束。
 *
 * @param taskId 任务ID
 * @param options 轮询选项
 * @return 结束状态的任务
 */
export async function waitVideoCompositionTask(taskId: string, options: { signal?: AbortSignal; onProgress?: (task: VideoCompositionTask) => void } = {}): Promise<VideoCompositionTask> {
    const pollIntervalMilliseconds = await getAiTaskPollingIntervalMilliseconds();
    while (true) {
        throwIfAborted(options.signal);
        const task = await getCompositionTask(taskId);
        if (isFinalVideoCompositionTaskStatus(task.status)) return task;
        options.onProgress?.(task);
        await waitForPollInterval(pollIntervalMilliseconds, options.signal);
    }
}

/**
 * 判断视频合成任务是否已结束。
 *
 * @param status 任务状态
 * @return 是否已结束
 */
export function isFinalVideoCompositionTaskStatus(status: VideoCompositionTaskStatus): boolean {
    return status === "succeeded" || status === "failed" || status === "canceled";
}

/**
 * 等待下一次轮询或中止信号。
 *
 * @param milliseconds 等待毫秒数
 * @param signal 中止信号
 * @return 等待Promise
 */
function waitForPollInterval(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let timeoutId = 0;
        const abort = () => {
            window.clearTimeout(timeoutId);
            signal?.removeEventListener("abort", abort);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const finish = () => {
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        timeoutId = window.setTimeout(finish, milliseconds);
        if (!signal) return;
        if (signal.aborted) {
            abort();
            return;
        }
        signal.addEventListener("abort", abort, { once: true });
    });
}

/**
 * 在请求前检查中止状态。
 *
 * @param signal 中止信号
 */
function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
