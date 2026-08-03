import type { ComponentProps } from "react";
import { Zap } from "lucide-react";
import { Tooltip } from "antd";

export { getModelCreditUnit, isPositiveVideoSeconds, requestCreditCost } from "./credit-calculation";
export type { CreditCostOptions, ModelCreditCost } from "./credit-calculation";

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
