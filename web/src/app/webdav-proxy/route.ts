import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 代理请求超时（毫秒）。 */
const PROXY_TIMEOUT_MS = 120_000;
/** 转发到上游的请求头映射：源（自定义头）→ 目标（标准头）。 */
const HEADER_MAP: ReadonlyArray<readonly [from: string, to: string]> = [
    ["x-webdav-authorization", "Authorization"],
    ["x-webdav-depth", "Depth"],
    ["x-webdav-destination", "Destination"],
    ["x-webdav-overwrite", "Overwrite"],
    ["x-webdav-content-type", "Content-Type"],
] as const;
/** 透传回客户端的响应头。 */
const PASSTHROUGH_RESPONSE_HEADERS = ["content-type", "etag", "last-modified", "dav"] as const;

/**
 * WebDAV 服务端代理：把客户端通过自定义头描述的 WebDAV 请求转发到目标地址。
 * <p>
 * 用于规避浏览器 CORS 限制；仅允许 http/https 目标，超时返回 504，其它错误返回 502。
 * GET/HEAD 不转发请求体。
 *
 * @param request 入站请求
 * @return 代理响应；参数缺失/非法返回 400
 */
export async function POST(request: NextRequest): Promise<Response> {
    const target = request.headers.get("x-webdav-target") ?? "";
    if (!target) return new Response("Missing x-webdav-target", { status: 400 });

    const method = (request.headers.get("x-webdav-method") ?? "GET").toUpperCase();

    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return new Response("Invalid x-webdav-target", { status: 400 });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return new Response("Unsupported WebDAV target", { status: 400 });
    }

    const headers = buildUpstreamHeaders(request);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    try {
        const body = needsBody(method) ? await request.arrayBuffer() : undefined;
        console.log(`[webdav-proxy] ${method} ${url.href} ${body?.byteLength ?? 0}B`);
        const upstream = await fetch(url, {
            method,
            headers,
            body: body && body.byteLength > 0 ? body : undefined,
            signal: controller.signal,
        });
        console.log(`[webdav-proxy] ${method} ${url.href} -> ${upstream.status}`);
        return new Response(method === "HEAD" ? null : upstream.body, {
            status: upstream.status,
            headers: filterResponseHeaders(upstream.headers),
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return new Response("WebDAV proxy timeout", { status: 504 });
        }
        return new Response(error instanceof Error ? error.message : "WebDAV proxy error", { status: 502 });
    } finally {
        clearTimeout(timer);
    }
}

/** 是否需要转发请求体：GET/HEAD 不转发。 */
function needsBody(method: string): boolean {
    return method !== "GET" && method !== "HEAD";
}

/** 按映射表从入站请求构造转发到上游的请求头。 */
function buildUpstreamHeaders(request: NextRequest): Headers {
    const headers = new Headers();
    for (const [from, to] of HEADER_MAP) {
        const value = request.headers.get(from);
        if (value) headers.set(to, value);
    }
    return headers;
}

/** 仅保留白名单响应头透传回客户端。 */
function filterResponseHeaders(headers: Headers): Headers {
    const result = new Headers();
    for (const key of PASSTHROUGH_RESPONSE_HEADERS) {
        const value = headers.get(key);
        if (value) result.set(key, value);
    }
    return result;
}
