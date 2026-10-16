
import { translateMessage as translate } from "@/features/locale/translate";
const OAUTH2_REDIRECT_SESSION_KEY = "novanova:oauth2:redirect:v1";

const OAUTH2_ERROR_MESSAGES: Record<string, string> = {
    get accessDenied() { return translate("auth.thirdPartyAuthorizationCanceled"); },
    get accountInactive() { return translate("auth.thirdPartyAccountIsNotActive"); },
    get accountDisabled() { return translate("auth.yourLocalAccountIsDisabled"); },
    get accountAlreadyBound() { return translate("auth.thisAccountIsAlreadyLinkedToAnotherIdentityFrom"); },
    get accountUnavailable() { return translate("auth.thisAccountCannotSignInRightNow"); },
    get emailUnavailable() { return translate("auth.noUsableEmailFromProviderSignInUnavailable"); },
    get emailUnverified() { return translate("auth.thirdPartyEmailIsUnverifiedSignInUnavailable"); },
    get providerIdentityUnavailable() { return translate("auth.cannotReadThirdPartyIdentity"); },
    get providerProfileInvalid() { return translate("auth.thirdPartyProfileExceedsFieldLimits"); },
    get providerUnavailable() { return translate("auth.thisSignInProviderIsDisabled"); },
    get invitationContextExpired() { return translate("auth.invitationAuthorizationExpiredSignInFromTheInvitationAgain"); },
    get invitationContextInvalid() { return translate("auth.invalidInvitationAuthorizationSignInFromTheInvitationAgain"); },
    get authorizationFailed() { return translate("auth.authorizationFailedTryAgain"); },
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
    if (!errorCode) return translate("auth.oAuth2SignInFailedTryAgain");
    return OAUTH2_ERROR_MESSAGES[errorCode] || translate("auth.oAuth2SignInFailedTryAgain");
}
