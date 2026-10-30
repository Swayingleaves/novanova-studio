import { isAuthenticationPath, parseSpacePath, pathInSpace } from "@/features/team/space-path";

/** 校验登录目标并限定团队入口只能回到当前团队，空目标进入当前空间首页。 */
export function resolveAuthenticationRedirect(value: string | null | undefined, teamSlug: string | null) {
    if (!value) return pathInSpace("/", teamSlug);
    if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) throw new Error("登录跳转地址无效");
    const url = new URL(value, "https://novanova.invalid");
    let decodedPathname: string;
    try { decodedPathname = decodeURIComponent(url.pathname); }
    catch { throw new Error("登录跳转地址无效"); }
    if (url.origin !== "https://novanova.invalid" || /%2f|%5c/i.test(url.pathname) || /[\\\u0000-\u001f\u007f]/.test(decodedPathname) || decodedPathname.includes("//")) throw new Error("登录跳转地址无效");
    if (isAuthenticationPath(decodedPathname)) throw new Error("登录后不能跳转到认证页面");
    const target = parseSpacePath(decodedPathname);
    if (teamSlug && target.teamSlug && target.teamSlug !== teamSlug) throw new Error("团队登录不能跳转到其他团队");
    const destination = `${url.pathname}${url.search}${url.hash}`;
    const scoped = pathInSpace(destination, teamSlug);
    if (teamSlug && parseSpacePath(scoped).teamSlug !== teamSlug) throw new Error("团队登录只能跳转到当前团队内的页面");
    return scoped;
}

/** 生成团队登录地址，保留原业务目标及查询参数。 */
export function authenticationPath(teamSlug: string, redirect?: string) {
    const target = resolveAuthenticationRedirect(redirect, teamSlug);
    return `${pathInSpace("/auth", teamSlug)}${redirect ? `?redirect=${encodeURIComponent(target)}` : ""}`;
}
