const OAUTH2_REDIRECT_SESSION_KEY = "novanova:oauth2:redirect:v1";

const OAUTH2_ERROR_MESSAGES: Record<string, string> = {
    accessDenied: "你已取消第三方平台授权。",
    accountInactive: "当前第三方账号不是正常活动状态。",
    accountDisabled: "当前本地账号已被禁用。",
    accountAlreadyBound: "当前本地账号已经绑定其他同渠道身份。",
    accountUnavailable: "当前账号暂时无法登录。",
    emailUnavailable: "第三方平台未返回可用邮箱，无法完成登录。",
    emailUnverified: "第三方账号邮箱尚未验证，无法完成登录。",
    providerIdentityUnavailable: "无法读取第三方账号身份。",
    providerProfileInvalid: "第三方账号资料超过系统字段限制。",
    providerUnavailable: "当前第三方登录渠道未启用。",
    authorizationFailed: "第三方平台授权失败，请重新尝试。",
};

/** 校验站内重定向目标，拒绝外部地址和认证页面循环跳转。 */
export function safeAuthRedirect(value: string | null | undefined) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
    if (value.startsWith("/auth")) return "/";
    return value;
}

/** 保存OAuth2登录完成后的站内跳转目标。 */
export function storeOAuth2Redirect(value: string | null | undefined) {
    if (typeof window === "undefined") return false;
    try {
        window.sessionStorage.setItem(OAUTH2_REDIRECT_SESSION_KEY, safeAuthRedirect(value));
        return true;
    } catch {
        return false;
    }
}

/** 读取并清除OAuth2登录完成后的站内跳转目标。 */
export function consumeOAuth2Redirect() {
    if (typeof window === "undefined") return "/";
    try {
        const redirect = safeAuthRedirect(window.sessionStorage.getItem(OAUTH2_REDIRECT_SESSION_KEY));
        window.sessionStorage.removeItem(OAUTH2_REDIRECT_SESSION_KEY);
        return redirect;
    } catch {
        return null;
    }
}

/** 将服务端固定OAuth2错误码转换为中文提示。 */
export function oauth2ErrorMessage(errorCode: string | null | undefined) {
    if (!errorCode) return "OAuth2登录失败，请重新尝试。";
    return OAUTH2_ERROR_MESSAGES[errorCode] || "OAuth2登录失败，请重新尝试。";
}
