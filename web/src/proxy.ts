import { NextRequest, NextResponse } from "next/server";
import { languageCookieMaxAge, languageCookieName, resolveWebsiteLocale } from "./features/locale/locale";

/** 请求入口统一解析语言，供服务端首屏和客户端共用。 */
export function proxy(request: NextRequest) {
    const locale = resolveWebsiteLocale(request.nextUrl.pathname, request.cookies.get(languageCookieName)?.value, request.headers.get("accept-language"));
    const headers = new Headers(request.headers);
    headers.set("x-novanova-language", locale);
    headers.set("x-novanova-pathname", request.nextUrl.pathname);
    const teamMatch = request.nextUrl.pathname.match(/^\/team\/([^/]+)(.*)$/);
    if (teamMatch) {
        const destination = request.nextUrl.clone();
        destination.pathname = teamMatch[2] || "/";
        headers.set("x-novanova-team-slug", teamMatch[1]);
        headers.set("x-novanova-pathname", destination.pathname);
        return NextResponse.rewrite(destination, { request: { headers } });
    }
    const response = NextResponse.next({ request: { headers } });
    const prefetch = request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
    if (!prefetch && /^\/docs\/(zh-cn|en)(?:\/|$)/.test(request.nextUrl.pathname)) {
        response.cookies.set(languageCookieName, locale, { path: "/", maxAge: languageCookieMaxAge, sameSite: "lax" });
    }
    return response;
}

export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
