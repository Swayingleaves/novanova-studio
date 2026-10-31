import { createTranslator, type TranslationValues } from "next-intl";
import { websiteMessages } from "./messages";
import { isWebsiteLocale, languageTag, type WebsiteLocale } from "./locale";

/** 读取客户端当前语言，服务端调用请显式传入请求语言。 */
export function currentWebsiteLocale(): WebsiteLocale {
    const locale = typeof document === "undefined" ? undefined : document.documentElement.dataset.language;
    return isWebsiteLocale(locale) ? locale : "zh-cn";
}

/** 为两种语言创建相同类型的翻译入口，不缓存翻译后的业务数据。 */
function createWebsiteTranslator(locale: WebsiteLocale) {
    return createTranslator({ locale: languageTag(locale), messages: websiteMessages[locale] });
}

const translators = { "zh-cn": createWebsiteTranslator("zh-cn"), en: createWebsiteTranslator("en") };

export type TranslationKey = Parameters<ReturnType<typeof createWebsiteTranslator>>[0];

/** 按当前语言翻译固定系统文案。 */
export function translateMessage(key: TranslationKey, values?: TranslationValues, locale = currentWebsiteLocale()): string {
    return translators[locale](key, values);
}

/** 日期和数字格式化共用语言标签，不改变时区。 */
export function currentLanguageTag(): string {
    return languageTag(currentWebsiteLocale());
}
