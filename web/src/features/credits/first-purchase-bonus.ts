import Decimal from "decimal.js";

import { creditAmount } from "@/shared/lib/credit-amounts";

/** 平台积分兑换口径：1 元等于 10 积分。 */
export const CREDITS_PER_YUAN = 10;

const HUNDRED = new Decimal(100);

/**
 * 计算首充赠送积分：支付金额折算积分后乘以比例，六位小数向下取整。
 * <p>
 * 必须显式指定 ROUND_DOWN，credit-amounts 全局配置是 ROUND_HALF_UP，直接复用会与服务端差最后一位。
 *
 * @param priceAmount 订单支付金额，单位元
 * @param percent 赠送比例，单位百分数
 * @return 赠送积分
 */
export function firstPurchaseBonusCredits(priceAmount: Decimal.Value, percent: Decimal.Value): Decimal {
    const ratio = creditAmount(percent);
    if (ratio.lte(0)) return new Decimal(0);
    return creditAmount(priceAmount).mul(CREDITS_PER_YUAN).mul(ratio).div(HUNDRED).toDecimalPlaces(6, Decimal.ROUND_DOWN);
}

/**
 * 把赠送积分换算成展示金额，两位小数向下取整。
 *
 * @param bonusCredits 赠送积分
 * @return 展示金额，单位元
 */
export function firstPurchaseBonusYuan(bonusCredits: Decimal.Value): Decimal {
    return creditAmount(bonusCredits).div(CREDITS_PER_YUAN).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

/**
 * 判断展示金额是否与积分严格对应，用于决定是否加「约」。
 *
 * @param bonusYuan 展示金额，单位元
 * @param bonusCredits 赠送积分
 * @return 换算后与原积分一致时为 true
 */
export function isExactBonusYuan(bonusYuan: Decimal.Value, bonusCredits: Decimal.Value): boolean {
    return creditAmount(bonusYuan).mul(CREDITS_PER_YUAN).eq(creditAmount(bonusCredits));
}

/**
 * 计算本次实际生效的赠送额度：商品自带赠送与首充赠送取较大者，不叠加。
 *
 * @param productBonus 商品自带的赠送积分
 * @param priceAmount 订单支付金额
 * @param percent 首充赠送比例，单位百分数
 * @return 生效的赠送积分
 */
export function firstPurchaseEffectiveBonus(productBonus: Decimal.Value, priceAmount: Decimal.Value, percent: Decimal.Value): Decimal {
    return Decimal.max(creditAmount(productBonus), firstPurchaseBonusCredits(priceAmount, percent));
}

/**
 * 计算含赠送的到账总积分。
 *
 * @param productCredits 商品基础积分
 * @param productBonus 商品自带的赠送积分
 * @param priceAmount 订单支付金额
 * @param percent 首充赠送比例，单位百分数
 * @return 到账总积分
 */
export function firstPurchaseTotalCredits(productCredits: Decimal.Value, productBonus: Decimal.Value, priceAmount: Decimal.Value, percent: Decimal.Value): Decimal {
    return creditAmount(productCredits).add(firstPurchaseEffectiveBonus(productBonus, priceAmount, percent));
}
