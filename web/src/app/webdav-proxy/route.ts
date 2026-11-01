/**
 * 关闭已停用的 WebDAV 代理，保留路由以覆盖增量部署中的旧实现。
 *
 * @return 不访问任何上游地址的 404 响应
 */
export function POST(): Response {
    return new Response(null, { status: 404 });
}
