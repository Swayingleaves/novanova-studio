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
    taskType: ModelCreditCost["taskType"];
    /** 请求次数，可为字符串。 */
    count?: string | number;
    /** 视频时长，可为字符串。 */
    seconds?: string | number;
}

/** 查询单个模型的积分单价，未配置时为0。 */
function unitCost(modelCosts: ModelCreditCost[], model: string, taskType: ModelCreditCost["taskType"]): number {
    return modelCosts.find((item) => item.model === model && item.taskType === taskType)?.credits ?? 0;
}

/** 查询模型计费单位，历史配置缺少字段时按次计费。 */
export function getModelCreditUnit(modelCosts: ModelCreditCost[], model: string, taskType: ModelCreditCost["taskType"]): ModelCreditUnit {
    return modelCosts.find((item) => item.model === model && item.taskType === taskType)?.unit === "second" ? "second" : "generation";
}

/** 判断值是否为正整数秒数。 */
export function isPositiveVideoSeconds(value: string | number | undefined): boolean {
    const text = String(value ?? "").trim();
    return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) > 0;
}

/**
 * 计算一次请求的积分消耗。
 *
 * @param options 计算入参
 * @return number 本次请求应消耗的积分
 */
export function requestCreditCost(options: CreditCostOptions): number {
    if (options.taskType === "text") return 0;
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    const credits = unitCost(options.modelCosts, options.model, options.taskType);
    if (options.taskType === "video" && getModelCreditUnit(options.modelCosts, options.model, options.taskType) === "second") {
        if (!isPositiveVideoSeconds(options.seconds)) return 0;
        return credits * Number(options.seconds) * count;
    }
    return credits * count;
}
