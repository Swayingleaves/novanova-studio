import type { ServerCreditDirection, ServerCreditDistributionItem, ServerCreditSource, ServerCreditTransactionType, ServerGenerationSource } from "@/services/api/server";

export const CREDIT_TRANSACTION_PAGE_SIZE = 20;

/** 积分明细方向筛选选项。 */
export const CREDIT_DIRECTION_OPTIONS: { label: string; value: "all" | ServerCreditDirection }[] = [
    { label: "全部", value: "all" },
    { label: "增加", value: "add" },
    { label: "消耗", value: "spend" },
];

/** 积分明细来源筛选选项。 */
export const CREDIT_SOURCE_OPTIONS: { label: string; value: "all" | ServerCreditSource }[] = [
    { label: "全部来源", value: "all" },
    { label: "图片生成", value: "image" },
    { label: "视频生成", value: "video" },
    { label: "卡密兑换", value: "card_redeem" },
    { label: "管理员调整", value: "admin_adjustment" },
    { label: "任务退款", value: "task_refund" },
    { label: "初始发放", value: "initial_grant" },
];

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
    return generationType === "video" ? "视频生成" : "图片生成";
}

/**
 * 将积分流水类型转换为中文文案。
 *
 * @param transactionType 积分流水类型
 * @return 中文流水类型文案
 */
export function creditTransactionTypeLabel(transactionType: ServerCreditTransactionType | null | undefined) {
    if (transactionType === "task_charge") return "任务扣费";
    if (transactionType === "task_refund") return "任务退款";
    if (transactionType === "admin_adjustment") return "管理员调整";
    if (transactionType === "card_redeem") return "卡密兑换";
    if (transactionType === "initial_grant") return "初始发放";
    return "未知类型";
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
    if (generationSource === "imagePage") return "图片创作";
    if (generationSource === "videoPage") return "视频创作";
    if (generationSource === "canvas") return "无限画布";
    if (generationSource === "storyboard") return "分镜脚本";
    return "未记录";
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
        { name: "图片生成", value: consumedCreditsByType.get("image") || 0 },
        { name: "视频生成", value: consumedCreditsByType.get("video") || 0 },
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
    return (credits ?? 0).toLocaleString("zh-CN");
}

/**
 * 格式化扣费时间。
 *
 * @param createdAt 服务端扣费时间
 * @return 上海时区的中文时间文本
 */
export function formatCreditTime(createdAt: string) {
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(createdAt));
}
