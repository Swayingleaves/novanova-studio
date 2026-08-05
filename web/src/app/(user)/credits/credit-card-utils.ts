export const CREDIT_CARD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CREDIT_CARD_LENGTH = 20;

const creditCardPattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}$/;

/**
 * 规范化用户输入的积分卡密。
 *
 * @param value 原始卡密
 * @returns 去除空白、分隔符并转为大写后的卡密
 */
export function normalizeCreditCardCode(value: string) {
    return value.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * 判断是否为完整积分卡密。
 *
 * @param value 卡密文本
 * @returns 是否符合20位字符规则
 */
export function isCreditCardCode(value: string) {
    return creditCardPattern.test(normalizeCreditCardCode(value));
}

/**
 * 生成卡密脱敏展示文本。
 *
 * @param value 完整卡密
 * @returns 脱敏卡密
 */
export function maskCreditCardCode(value: string) {
    const normalized = normalizeCreditCardCode(value);
    if (!isCreditCardCode(normalized)) return "****-****-****-****-****";
    return `****-****-****-****-${normalized.slice(-4)}`;
}

/**
 * 将批量卡密转换为可直接粘贴到发卡网站的逐行文本。
 *
 * @param values 卡密列表
 * @returns 每行一个卡密的文本
 */
export function creditCardBatchText(values: string[]) {
    return values.map((value) => normalizeCreditCardCode(value)).filter(Boolean).join("\n");
}
