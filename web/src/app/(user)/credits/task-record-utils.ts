import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
import type { CreditAmount } from "@/shared/lib/credit-amounts";
import { translateMessage as translate } from "@/features/locale/translate";

import type { ServerAiTaskStatus } from "@/services/api/server";

/** 任务记录每页条数。 */
export const TASK_RECORD_PAGE_SIZE = 20;

/**
 * 将生成任务状态转换为用户可见文案。
 *
 * @param status 任务状态
 * @return 中文状态文案
 */
export function taskRecordStatusLabel(status: ServerAiTaskStatus) {
    if (status === "pending") return translate("credits.statusPending");
    if (status === "running") return translate("credits.statusRunning");
    if (status === "success") return translate("credits.statusSuccess");
    if (status === "failed") return translate("credits.statusFailed");
    return translate("credits.statusCanceled");
}

/**
 * 获取任务状态对应的 Ant Design 标签色。
 *
 * @param status 任务状态
 * @return 标签色
 */
export function taskRecordStatusTone(status: ServerAiTaskStatus) {
    if (status === "success") return "success";
    if (status === "failed") return "error";
    if (status === "canceled") return "default";
    return "processing";
}

/**
 * 格式化任务实际消耗积分，失败退款后的净消耗显示为 0。
 *
 * @param consumedCredits 净消耗积分
 * @return 带负号的消耗文本
 */
export function formatConsumedCredits(consumedCredits: CreditAmount | null | undefined) {
    const amount = creditAmount(consumedCredits ?? 0);
    return amount.greaterThan(0) ? `-${creditText(amount)}` : "0";
}

/**
 * 获取任务记录中的用户展示名称。
 *
 * @param user 用户昵称、用户名和邮箱
 * @return 优先昵称，其次用户名和邮箱；均缺失时返回占位符
 */
export function taskRecordUserLabel(user: { nickname?: string | null; username?: string | null; email?: string | null }) {
    return user.nickname || user.username || user.email || "—";
}

/**
 * 格式化任务从创建到完成的耗时。
 *
 * 不足 60 秒只显示秒；达到 60 秒显示分钟和剩余秒。任务未完成或时间无效时返回占位符。
 *
 * @param createdAt 任务创建时间
 * @param completedAt 任务完成时间
 * @return 耗时文案，例如 10s、1分10s
 */
export function formatTaskElapsedTime(createdAt: string | null | undefined, completedAt: string | null | undefined) {
    if (!createdAt || !completedAt) return "—";
    const startedAt = Date.parse(createdAt);
    const finishedAt = Date.parse(completedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return "—";
    const totalSeconds = Math.floor((finishedAt - startedAt) / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    return translate("credits.elapsedMinutes", { value0: minutes, value1: totalSeconds % 60 });
}
