import localforage from "localforage";

const mediaStore = localforage.createInstance({
    name: "novanova-studio",
    storeName: "homepage_media",
});

const inflight = new Map<string, Promise<Blob | null>>();

/**
 * 首页媒体缓存键。
 * <p>
 * 服务端返回的是临时签名地址，签名参数每次都可能变化，必须丢弃；但缩略图与原图的对象键相同，
 * 只靠图像处理参数区分，所以这些参数必须保留，否则缩略图会污染原图缓存。
 */
export function homepageMediaCacheKey(url?: string) {
    const value = url?.trim();
    if (!value) return "";
    const separator = value.indexOf("?");
    if (separator < 0) return value;
    const base = value.slice(0, separator);
    const processing = value.slice(separator + 1).split("&").filter((part) => {
        const name = decodeURIComponent(part.split("=")[0]);
        return name.startsWith("x-oss-process") || name.startsWith("imageMogr2") || name.startsWith("imageView2");
    });
    return processing.length ? `${base}?${processing.join("&")}` : base;
}

/**
 * 读取首页作品媒体。
 * <p>
 * 首页按完整画面展示，不做缩放，直接缓存对象存储返回的原始字节；命中本地缓存后不再请求。
 */
export function loadHomepageMedia(url: string): Promise<Blob | null> {
    const key = homepageMediaCacheKey(url);
    if (!key) return Promise.resolve(null);
    const current = inflight.get(key);
    if (current) return current;
    const task = (async () => {
        const cached = await mediaStore.getItem<Blob>(key).catch(() => null);
        if (cached instanceof Blob && cached.size > 0) return cached;
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const blob = await response.blob();
            if (!blob.size) return null;
            await mediaStore.setItem(key, blob).catch(() => undefined);
            return blob;
        } catch (error) {
            console.error("读取首页作品媒体失败", key, error);
            return null;
        }
    })();
    inflight.set(key, task);
    void task.finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
    });
    return task;
}
