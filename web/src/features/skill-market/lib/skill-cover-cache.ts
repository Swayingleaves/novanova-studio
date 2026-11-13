import localforage from "localforage";

const coverStore = localforage.createInstance({
    name: "novanova-studio",
    storeName: "skill_covers",
});

const inflight = new Map<string, Promise<Blob | null>>();

/**
 * 技能封面缓存键。
 * <p>
 * 服务端返回的是临时签名地址，去掉查询参数后同一个封面始终用同一把缓存键，重新签名也能命中。
 */
export function skillCoverCacheKey(url?: string) {
    return url?.trim().split("?")[0] || "";
}

/**
 * 读取技能封面。
 * <p>
 * 服务端已按卡片尺寸缩放，这里按原字节缓存，命中后不再请求对象存储。
 */
export function loadSkillCover(url: string): Promise<Blob | null> {
    const key = skillCoverCacheKey(url);
    if (!key) return Promise.resolve(null);
    const current = inflight.get(key);
    if (current) return current;
    const task = (async () => {
        const cached = await coverStore.getItem<Blob>(key).catch(() => null);
        if (cached instanceof Blob && cached.size > 0) return cached;
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const blob = await response.blob();
            if (!blob.size) return null;
            await coverStore.setItem(key, blob).catch(() => undefined);
            return blob;
        } catch (error) {
            console.error("读取技能封面失败", key, error);
            return null;
        }
    })();
    inflight.set(key, task);
    void task.finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
    });
    return task;
}
