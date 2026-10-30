/**
 * Novanova Studio PWA Service Worker 模板。
 *
 * 设计原则：保守缓存，永不缓存页面 HTML 与业务数据（登录态过期、数据陈旧、安全风险）。
 * 由 scripts/generate-pwa.mjs 在生产构建后替换占位符并输出 public/novanova-sw.js。
 */

/** 缓存前缀：activate 阶段按前缀清理旧版本缓存。 */
const CACHE_PREFIX = "__CACHE_PREFIX__";

/** 缓存版本号：构建产物内容哈希，任何产物变化都会改变该值，保证缓存精确失效。 */
const CACHE_NAME = CACHE_PREFIX + "-" + "__CACHE_NAME__";

/** 部署 base 路径，以 "/" 开头且以 "/" 结尾。 */
const BASE = "__BASE__";

/** 离线回退页地址（已被预缓存）。 */
const OFFLINE_URL = "__OFFLINE_URL__";

/** 预缓存白名单：离线页 + PWA 图标等公共静态资产。 */
const PUBLIC_ASSETS = __PUBLIC_ASSETS__;

/** API 与敏感路径正则：匹配到的请求一律不被 SW 接管。 */
const API_PATTERN = /\/(api|attachments|exports|downloads|__mock)(?:\/|$)/;

/** 文件扩展名正则：带扩展名的路径按静态文件处理，不参与导航离线回退。 */
const FILE_EXTENSION_PATTERN = /\.[a-zA-Z0-9]+$/;

self.addEventListener("install", (event) => {
    // 不调用 skipWaiting：新版本等待用户在页面上显式确认后再激活。
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await Promise.all(
                PUBLIC_ASSETS.map(async (asset) => {
                    try {
                        await cache.add(new Request(asset, { credentials: "omit", cache: "reload" }));
                    } catch (error) {
                        // 预缓存单个资产失败不阻塞安装（例如个别图标临时不可达）。
                    }
                }),
            );
        })(),
    );
});

self.addEventListener("activate", (event) => {
    // 不调用 clients.claim：避免打断其他已打开标签页正在进行的操作。
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                    .map((key) => caches.delete(key)),
            );
        })(),
    );
});

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "PWA_ACTIVATE") {
        self.skipWaiting();
    }
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // 路径 A：静态公共资产（白名单命中 + 无 query + 无鉴权头）→ cache-first。
    if (!url.search && PUBLIC_ASSETS.includes(url.pathname) && !request.headers.has("Authorization")) {
        event.respondWith(servePublicAsset(request));
        return;
    }

    // 路径 B：页面导航（navigate 模式 + BASE 前缀 + 非 API + 无文件扩展名）→ 在线直连，断网回退离线页。
    if (
        request.mode === "navigate" &&
        url.pathname.startsWith(BASE) &&
        !API_PATTERN.test(url.pathname) &&
        !FILE_EXTENSION_PATTERN.test(url.pathname)
    ) {
        event.respondWith(serveNavigation(request));
    }
    // 其余请求一律不拦截，走浏览器默认行为。
});

/** cache-first 命中白名单的公共资产；未命中回源并写入缓存。 */
async function servePublicAsset(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
        cache.put(request, response.clone());
    }
    return response;
}

/** 页面导航在线时透传真实响应（含 401/403/5xx），绝不缓存导航 HTML；网络失败时返回缓存的离线页。 */
async function serveNavigation(request) {
    try {
        return await fetch(request);
    } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match(OFFLINE_URL);
        if (offline) return offline;
        throw error;
    }
}
