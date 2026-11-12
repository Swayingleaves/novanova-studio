import localforage from "localforage";

const mediaStore = localforage.createInstance({
    name: "novanova-studio",
    storeName: "homepage_media",
});

const inflight = new Map<string, Promise<Blob | null>>();

/**
 * 首页媒体缓存键。
 * <p>
 * 服务端返回的是临时签名地址，去掉查询参数后同一个对象始终用同一把缓存键，重新签名也能命中。
 */
export function homepageMediaCacheKey(url?: string) {
    return url?.trim().split("?")[0] || "";
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
