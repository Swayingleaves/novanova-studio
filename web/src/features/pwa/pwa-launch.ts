"use client";

import { PWA_BASE_PATH, PWA_LAUNCH_PARAM } from "./pwa-constants";

/**
 * 判断 URL 是否为 base 根路径（如 "/" 或 "/app/"）。
 * 深层链接（如 "/canvas?id=1"）不算根路径。
 */
export function isBaseRootPath(url: URL, base: string = PWA_BASE_PATH): boolean {
    const trimmedBase = base.length > 1 && base.endsWith("/") ? base.slice(0, -1) : base;
    return url.pathname === trimmedBase || url.pathname === `${trimmedBase}/`;
}

/**
 * 从 URL 中剥离 pwa-launch 参数，返回相对路径（保留其余参数与 hash）。
 * 若原本不含该参数则原样返回。
 */
export function stripLaunchParam(url: string): string {
    const parsed = new URL(url);
    if (!parsed.searchParams.has(PWA_LAUNCH_PARAM)) {
        return parsed.pathname + parsed.search + parsed.hash;
    }
    parsed.searchParams.delete(PWA_LAUNCH_PARAM);
    return parsed.pathname + parsed.search + parsed.hash;
}

/**
 * 消费桌面图标启动标记（对应 PRD 4.6.4）。
 *
 * manifest 的 start_url 带 ?pwa-launch=1：应用启动时若检测到该参数且当前
 * 是 base 根路径，则通过 history.replaceState 清除（不产生历史记录）；
 * 深层链接必须原样保留参数，绝不吞掉。
 */
export function consumePwaLaunchParam(base: string = PWA_BASE_PATH): void {
    if (typeof window === "undefined") {
        return;
    }
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PWA_LAUNCH_PARAM) || !isBaseRootPath(url, base)) {
        return;
    }
    window.history.replaceState(window.history.state, "", stripLaunchParam(window.location.href));
}
