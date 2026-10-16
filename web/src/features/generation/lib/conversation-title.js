
import { translateMessage as translate } from "@/features/locale/translate";
export const MAX_CONVERSATION_TITLE_LENGTH = 100;

/**
 * 裁剪对话标题的首尾空格。
 *
 * @param {string} value 原始标题
 * @returns {string} 裁剪后的标题
 */
export function normalizeConversationTitle(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * 校验对话标题是否合法。
 *
 * @param {string} value 原始标题
 * @returns {string} 校验错误，为空字符串表示通过
 */
export function validateConversationTitle(value) {
    const normalizedTitle = normalizeConversationTitle(value);
    if (!normalizedTitle) {
        return translate("generation.titleIsRequired");
    }
    if (normalizedTitle.length > MAX_CONVERSATION_TITLE_LENGTH) {
        return translate("generation.titleMustNotExceedCharacters", { value0: MAX_CONVERSATION_TITLE_LENGTH });
    }
    return "";
}
