import { headers } from "next/headers";
import { isWebsiteLocale, type WebsiteLocale } from "./locale";

/** 从入口已经解析的请求头获取服务端语言。 */
export async function getWebsiteLocale(): Promise<WebsiteLocale> {
    const locale = (await headers()).get("x-novanova-language");
    return isWebsiteLocale(locale) ? locale : "zh-cn";
}
