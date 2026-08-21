import type { ModelCreditUnit } from "@/features/settings/stores/use-config-store";

/** 单个模型的积分消耗定义。 */
export interface ModelCreditCost {
    model: string;
    taskType: "image" | "video" | "text";
    credits: number;
    unit: ModelCreditUnit;
}

/** 请求积分消耗计算入参。 */
export interface CreditCostOptions {
    /** 各模型积分单价表。 */
    modelCosts: ModelCreditCost[];
    /** 当前模型标识。 */
    model: string;
    /** 任务类型。 */
    taskType: Exclude<ModelCreditCost["taskType"], "video">;
    /** 请求次数，可为字符串。 */
    count?: string | number;
}

/** 查询单个模型的积分单价，未配置时为0。 */
function unitCost(modelCosts: ModelCreditCost[], model: string, taskType: ModelCreditCost["taskType"]): number {
    return modelCosts.find((item) => item.model === model && item.taskType === taskType)?.credits ?? 0;
}

/**
 * 计算图片或文本请求的积分消耗。视频必须使用视频分档报价函数，不能回退到单一模型积分。
 *
 * @param options 计算入参
 * @return number 本次请求应消耗的积分
 */
export function requestCreditCost(options: CreditCostOptions): number {
    if (options.taskType === "text") return 0;
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    const credits = unitCost(options.modelCosts, options.model, options.taskType);
    return credits * count;
}
