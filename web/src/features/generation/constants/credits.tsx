import type { ComponentProps } from "react";
import { Zap } from "lucide-react";
import { Tooltip } from "antd";

/** 单个模型的积分消耗定义。 */
export interface ModelCreditCost {
    model: string;
    taskType: "image" | "video" | "text";
    credits: number;
}

/** 请求积分消耗计算入参。 */
interface CreditCostOptions {
    /** 各模型积分单价表。 */
    modelCosts: ModelCreditCost[];
    /** 当前模型标识。 */
    model: string;
    /** 任务类型。 */
    taskType: ModelCreditCost["taskType"];
    /** 请求次数，可为字符串。 */
    count?: string | number;
}

/**
 * 渲染积分符号（闪电图标）。
 *
 * @param props span 元素属性
 * @return 渲染结果
 */
export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className ?? ""}`}>
            <Zap className="size-[1em] fill-current" strokeWidth={2.4} />
        </span>
    );
}

/**
 * 渲染统一的积分消耗内容。
 *
 * @param creditCost 本次操作消耗的积分
 * @param className 自定义样式类名
 * @param props span 元素属性
 * @return 积分图标与数值
 */
export function CreditCostDisplay({ creditCost, className, ...props }: ComponentProps<"span"> & { creditCost: number }) {
    const formattedCreditCost = creditCost.toLocaleString();
    const description = `当前会消耗 ${formattedCreditCost} 积分`;
    return (
        <span {...props} className={`inline-flex items-center gap-1 tabular-nums ${className ?? ""}`}>
            <Tooltip title={description}>
                <CreditSymbol className="cursor-help" aria-label={description} />
            </Tooltip>
            {formattedCreditCost}
        </span>
    );
}

/** 查询单个模型的积分单价，未配置时为 0。 */
function unitCost(modelCosts: ModelCreditCost[], model: string, taskType: ModelCreditCost["taskType"]): number {
    return modelCosts.find((item) => item.model === model && item.taskType === taskType)?.credits ?? 0;
}

/**
 * 计算一次请求的积分消耗。
 * <p>
 * 文本任务不计费；图片次数取传入值的绝对值向下取整，不小于 1。
 *
 * @param options 计算入参
 * @return 积分消耗数
 */
export function requestCreditCost(options: CreditCostOptions): number {
    if (options.taskType === "text") {
        return 0;
    }
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    return unitCost(options.modelCosts, options.model, options.taskType) * count;
}
