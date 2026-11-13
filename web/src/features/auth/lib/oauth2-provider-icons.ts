/** 内置 OAuth2 登录渠道图标路径，按渠道标识区分。 */
const PROVIDER_ICON_PATHS: Record<string, string> = {
    google: "/icons/google.svg",
    linuxDo: "/icons/linuxdo.svg",
};

/**
 * 获取 OAuth2 登录渠道图标路径。
 *
 * @param providerId 渠道标识
 * @returns 图标路径，未知渠道返回空字符串
 */
export function oauth2ProviderIconPath(providerId: string): string {
    return PROVIDER_ICON_PATHS[providerId] ?? "";
}
