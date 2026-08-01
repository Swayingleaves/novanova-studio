import { cancelAiTask, createPromptOptimizationTask, waitAiTask, type PromptOptimizationType } from "@/services/api/server";

/**
 * 使用服务端配置的默认文本模型优化图片或视频生成提示词。
 *
 * @param generationType 图片或视频生成类型
 * @param prompt 用户原始提示词
 * @param signal 请求取消信号
 * @returns 优化后的提示词
 */
export async function optimizeGenerationPrompt(generationType: PromptOptimizationType, prompt: string, generationStyleIdsOrSignal?: number[] | AbortSignal, signal?: AbortSignal) {
    const generationStyleIds = Array.isArray(generationStyleIdsOrSignal) ? generationStyleIdsOrSignal : undefined;
    const requestSignal = generationStyleIdsOrSignal instanceof AbortSignal ? generationStyleIdsOrSignal : signal;
    const task = await createPromptOptimizationTask({ generationType, prompt, ...(generationStyleIds?.length ? { generationStyleIds } : {}) });
    if (requestSignal?.aborted) {
        void cancelAiTask(task.id).catch(() => {});
        throw new DOMException("Aborted", "AbortError");
    }
    const completed = await waitAiTask(task.id, { signal: requestSignal });
    const content = readOptimizedPrompt(completed.resultData);
    if (!content) throw new Error("AI 没有返回有效的优化提示词");
    return content;
}

/**
 * 从文本任务结果中读取并清理优化后的提示词。
 *
 * @param resultData 文本任务结果
 * @returns 清理后的提示词
 */
export function readOptimizedPrompt(resultData: unknown) {
    if (!resultData || typeof resultData !== "object") return "";
    const content = (resultData as { content?: unknown }).content;
    if (typeof content !== "string") return "";
    return content.trim().replace(/^```[\w-]*\s*/, "").replace(/```$/, "").trim();
}
