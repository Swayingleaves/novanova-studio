import type { ServerCreditDistributionItem, ServerGenerationSource } from "@/services/api/server";

export const CREDIT_TRANSACTION_PAGE_SIZE = 20;

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
 * 将生成来源转换为中文文案。
 *
 * @param generationSource 生成来源，可为空
 * @return 中文生成来源文案
 */
export function generationSourceLabel(generationSource: ServerGenerationSource | null) {
    if (generationSource === "imagePage") return "图片创作";
    if (generationSource === "videoPage") return "视频创作";
    if (generationSource === "canvas") return "无限画布";
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
export function formatCredits(credits: number) {
    return credits.toLocaleString("zh-CN");
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
