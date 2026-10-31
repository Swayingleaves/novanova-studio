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
