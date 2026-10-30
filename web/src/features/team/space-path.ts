/** 从地址提取团队与实际页面路径，查询参数和片段不参与空间判定。 */
export function parseSpacePath(value: string) {
    const pathname = value.split(/[?#]/, 1)[0];
    const match = pathname.match(/^\/team\/([^/]+)(\/.*)?$/);
    return { teamSlug: match?.[1] ?? null, pathname: match ? match[2] || "/" : pathname };
}

/** 认证页面不初始化创作数据和业务订阅。 */
export function isAuthenticationPath(value: string) {
    return /^\/auth(?:\/|$)/.test(parseSpacePath(value).pathname);
}

/** 将业务路径放入指定空间，已指定空间及平台独立入口保持原样。 */
export function pathInSpace(path: string, teamSlug: string | null) {
    if (!teamSlug || !path.startsWith("/") || path.startsWith("//") || /^\/(team|teams|api|docs)(?:\/|[?#]|$)/.test(path)) return path;
    return `/team/${teamSlug}${path === "/" ? "" : path}`;
}
