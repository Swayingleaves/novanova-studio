import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
import type { CreditAmount } from "@/shared/lib/credit-amounts";
import type { ModelCreditUnit } from "@/features/settings/stores/use-config-store";
import type { ImageResolution } from "@/features/generation/lib/image-size-mappings";

/** 单个模型的积分消耗定义。 */
export interface ModelCreditCost {
    model: string;
    taskType: "image" | "video" | "text";
    credits: CreditAmount;
    unit: ModelCreditUnit;
    /** 图片模型按清晰度配置的单价，未配置的档位回退到 credits。 */
    resolutionPrices?: Partial<Record<ImageResolution, CreditAmount>>;
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
    /** 图片请求的清晰度档位，用于取对应档位的单价。 */
    resolution?: string;
}

/** 查询单个模型的积分单价，未配置时为0；图片模型优先按清晰度取价。 */
function unitCost(modelCosts: ModelCreditCost[], model: string, taskType: ModelCreditCost["taskType"], resolution?: string): CreditAmount {
    const cost = modelCosts.find((item) => item.model === model && item.taskType === taskType);
    if (!cost) return 0;
    const resolutionKey = taskType === "image" && resolution ? (resolution.trim().toUpperCase() as ImageResolution) : undefined;
    const resolutionPrice = resolutionKey ? cost.resolutionPrices?.[resolutionKey] : undefined;
    // 空字符串不是合法金额，直接回退模型单价，避免 Decimal 抛错。
    const priceText = String(resolutionPrice ?? "").trim();
    return priceText === "" ? cost.credits : (resolutionPrice as CreditAmount);
}

/**
 * 计算图片或文本请求的积分消耗。视频必须使用视频分档报价函数，不能回退到单一模型积分。
 *
 * @param options 计算入参
 * @return number 本次请求应消耗的积分
 */
export function requestCreditCost(options: CreditCostOptions): CreditAmount {
    if (options.taskType === "text") return 0;
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    const credits = unitCost(options.modelCosts, options.model, options.taskType, options.resolution);
    return creditText(creditAmount(credits).times(count));
}
