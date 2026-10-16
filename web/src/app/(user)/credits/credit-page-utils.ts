import { currentLanguageTag } from "@/features/locale/translate";

import { translateMessage as translate } from "@/features/locale/translate";
import { CalendarCheck, Coins, Gift, Image as ImageIcon, RotateCcw, TimerOff, UserCog, UserPlus, Video } from "lucide-react";

import type { ServerCreditDirection, ServerCreditDistributionItem, ServerCreditSource, ServerCreditTransactionType, ServerGenerationSource, ServerUserCreditTransaction } from "@/services/api/server";

export const CREDIT_TRANSACTION_PAGE_SIZE = 20;

/** 积分明细方向筛选选项。 */
/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createCreditDirectionOptions = (translator: typeof translate = translate): { label: string; value: "all" | ServerCreditDirection }[] => ([
    { get label() { return translator("credits.all"); }, value: "all" },
    { get label() { return translator("credits.add"); }, value: "add" },
    { get label() { return translator("credits.usage"); }, value: "spend" },
]);

export const CREDIT_DIRECTION_OPTIONS = createCreditDirectionOptions();

/** 积分明细来源筛选选项。 */
/** 按调用方语言生成显示文案，业务值保持不变。 */
export const createCreditSourceOptions = (translator: typeof translate = translate): { label: string; value: "all" | ServerCreditSource }[] => ([
    { get label() { return translator("credits.allSources"); }, value: "all" },
    { get label() { return translator("credits.imageGeneration"); }, value: "image" },
    { get label() { return translator("credits.videoGeneration"); }, value: "video" },
    { get label() { return translator("credits.redeemCode"); }, value: "card_redeem" },
    { get label() { return translator("credits.adminAdjustment"); }, value: "admin_adjustment" },
    { get label() { return translator("credits.taskRefund"); }, value: "task_refund" },
    { get label() { return translator("credits.initialGrant"); }, value: "initial_grant" },
    { get label() { return translator("credits.referralReward"); }, value: "invitation_reward" },
    { get label() { return translator("credits.dailyCheckIn"); }, value: "daily_check_in" },
    { get label() { return translator("credits.creditExpiration"); }, value: "credit_expired" },
]);

export const CREDIT_SOURCE_OPTIONS = createCreditSourceOptions();

type ChartDataItem = {
    name: string;
    value: number;
};

/**
 * 将后端任务类型转换为中文文案。
 *
 * @param generationType 图片或视频任务类型
 * @return 中文任务类型文案
 */
export function generationTypeLabel(generationType: "image" | "video") {
    return generationType === "video" ? translate("credits.videoGeneration") : translate("credits.imageGeneration");
}

/**
 * 获取积分流水类型对应的展示图标。
 *
 * @param transaction 积分流水记录
 * @return 对应的 lucide 图标组件
 */
export function creditTransactionIcon(transaction: Pick<ServerUserCreditTransaction, "transactionType" | "generationType">) {
    if (transaction.transactionType === "task_charge") return transaction.generationType === "video" ? Video : ImageIcon;
    if (transaction.transactionType === "task_refund") return RotateCcw;
    if (transaction.transactionType === "card_redeem") return Coins;
    if (transaction.transactionType === "admin_adjustment") return UserCog;
    if (transaction.transactionType === "invitation_reward") return UserPlus;
    if (transaction.transactionType === "daily_check_in") return CalendarCheck;
    if (transaction.transactionType === "credit_expired") return TimerOff;
    return Gift;
}

/**
 * 将积分流水类型转换为中文文案。
 *
 * @param transactionType 积分流水类型
 * @return 中文流水类型文案
 */
export function creditTransactionTypeLabel(transactionType: ServerCreditTransactionType | null | undefined) {
    if (transactionType === "task_charge") return translate("credits.taskCharge");
    if (transactionType === "task_refund") return translate("credits.taskRefund");
    if (transactionType === "admin_adjustment") return translate("credits.adminAdjustment");
    if (transactionType === "card_redeem") return translate("credits.redeemCode");
    if (transactionType === "initial_grant") return translate("credits.initialGrant");
    if (transactionType === "invitation_reward") return translate("credits.referralReward");
    if (transactionType === "daily_check_in") return translate("credits.dailyCheckIn");
    if (transactionType === "credit_expired") return translate("credits.creditExpiration");
    return translate("credits.unknownType");
}

/**
 * 格式化带符号的积分变动。
 *
 * @param changeAmount 有符号积分变动，正数增加、负数消耗，可为空
 * @return 带符号千分位文本，如 +1,000 / -500
 */
export function formatCreditChange(changeAmount: number | null | undefined) {
    const amount = changeAmount ?? 0;
    return (amount > 0 ? "+" : "") + formatCredits(amount);
}

/**
 * 组装积分明细详情文案：任务流水显示生成类型与模型，其余显示变动原因。
 *
 * @param transactionType 积分流水类型
 * @param generationType 生成任务类型，非任务流水为 null
 * @param model 模型展示名，非任务流水为 null
 * @param reason 变动原因
 * @return 详情文案
 */
export function creditTransactionDetail(transactionType: ServerCreditTransactionType, generationType: "image" | "video" | null, model: string | null, reason: string | null | undefined) {
    if (transactionType === "task_charge" || transactionType === "task_refund") {
        const typeLabel = generationType ? generationTypeLabel(generationType) : "";
        return model ? `${typeLabel} · ${model}` : typeLabel;
    }
    return reason ?? "";
}

/**
 * 将生成来源转换为中文文案。
 *
 * @param generationSource 生成来源，可为空
 * @return 中文生成来源文案
 */
export function generationSourceLabel(generationSource: ServerGenerationSource | null) {
    if (generationSource === "imagePage") return translate("credits.imageCreation");
    if (generationSource === "videoPage") return translate("credits.videoCreation");
    if (generationSource === "canvas") return translate("credits.infiniteCanvas");
    if (generationSource === "storyboard") return translate("credits.storyboardScript");
    return translate("credits.notRecorded");
}

/**
 * 规范化图片与视频消耗分布，保证图表顺序稳定。
 *
 * @param items 后端任务类型消耗分布
 * @return 可直接用于图表的非零数据
 */
export function normalizeGenerationDistribution(items: ServerCreditDistributionItem[]): ChartDataItem[] {
    const consumedCreditsByType = new Map(items.map((item) => [item.name, item.consumedCredits]));
    return [
        { name: translate("credits.imageGeneration"), value: consumedCreditsByType.get("image") || 0 },
        { name: translate("credits.videoGeneration"), value: consumedCreditsByType.get("video") || 0 },
    ].filter((item) => item.value > 0);
}

/**
 * 将模型分布转换为图表数据。
 *
 * @param items 后端模型消耗分布
 * @return 可直接用于图表的数据
 */
export function normalizeModelDistribution(items: ServerCreditDistributionItem[]): ChartDataItem[] {
    return items.filter((item) => item.consumedCredits > 0).map((item) => ({ name: item.name, value: item.consumedCredits }));
}

/**
 * 格式化积分数值。
 *
 * @param credits 积分数量
 * @return 带千分位的积分文本
 */
export function formatCredits(credits: number | null | undefined) {
    return (credits ?? 0).toLocaleString(currentLanguageTag());
}

/**
 * 格式化扣费时间。
 *
 * @param createdAt 服务端扣费时间
 * @return 上海时区的中文时间文本
 */
export function formatCreditTime(createdAt: string) {
    return new Intl.DateTimeFormat(currentLanguageTag(), {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(createdAt));
}
