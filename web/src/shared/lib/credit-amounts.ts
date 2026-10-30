import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type CreditAmount = string | number;

/** 精确积分计算统一入口，禁止使用二进制浮点计算余额或报价。 */
export function creditAmount(value: Decimal.Value = "0") { return new Decimal(value); }

/** 接口金额统一普通十进制字符串，最多六位小数。 */
export function creditText(value: Decimal.Value = "0") { return creditAmount(value).toDecimalPlaces(6).toFixed().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); }

/** 只在图表坐标等近似展示场景转换数字，不用于计费或余额判断。 */
export function creditChartValue(value: Decimal.Value) { return creditAmount(value).toNumber(); }
