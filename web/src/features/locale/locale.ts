/** 网站支持的语言，文档路径与偏好使用相同标识。 */
export const websiteLocales = ["zh-cn", "en"] as const;
export type WebsiteLocale = (typeof websiteLocales)[number];
export const languageCookieName = "novanova_language";
export const languageCookieMaxAge = 31_536_000;

/** 校验显式语言标识。 */
export function isWebsiteLocale(value: unknown): value is WebsiteLocale {
    return value === "zh-cn" || value === "en";
}

/** 按浏览器语言权重选择支持的语言，没有匹配项时使用简体中文。 */
export function languageFromAcceptLanguage(header: string | null | undefined): WebsiteLocale {
    const languages = (header ?? "").toLowerCase().split(",").map((part) => {
        const [tag, ...parameters] = part.trim().split(";");
        const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
        return { tag, weight: quality === undefined ? 1 : Number(quality.trim().slice(2)) };
    }).filter(({ tag, weight }) => tag && Number.isFinite(weight) && weight > 0 && weight <= 1);
    languages.sort((left, right) => right.weight - left.weight);
    for (const { tag } of languages) {
        if (tag === "en" || tag.startsWith("en-")) return "en";
        if (tag === "zh" || tag.startsWith("zh-")) return "zh-cn";
    }
    return "zh-cn";
}

/** 路径优先于已保存偏好，最后使用浏览器语言。 */
export function resolveWebsiteLocale(pathname: string, preference?: string | null, acceptLanguage?: string | null): WebsiteLocale {
    const documentLocale = pathname.match(/^\/docs\/(zh-cn|en)(?:\/|$)/)?.[1];
    if (isWebsiteLocale(documentLocale)) return documentLocale;
    return isWebsiteLocale(preference) ? preference : languageFromAcceptLanguage(acceptLanguage);
}

/** HTML 与标准格式化 API 使用的语言标签。 */
export function languageTag(locale: WebsiteLocale): "zh-CN" | "en-US" {
    return locale === "en" ? "en-US" : "zh-CN";
}
