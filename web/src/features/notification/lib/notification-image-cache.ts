"use client";

import { useEffect, useState } from "react";
import localforage from "localforage";

const imageStore = localforage.createInstance({
    name: "novanova-studio",
    storeName: "notification_images",
});

const inflight = new Map<string, Promise<Blob | null>>();

/**
 * 公告图片缓存键：去掉对象存储临时预签名查询参数，重新签名后依然命中同一本地缓存。
 */
export function notificationImageCacheKey(url?: string | null): string {
    return url?.trim().split("?")[0] || "";
}

/**
 * 读取并按原始字节缓存公告图片到 IndexedDB，命中后不再请求对象存储，节省带宽资源。
 */
export function loadCachedNotificationImage(url: string): Promise<Blob | null> {
    const key = notificationImageCacheKey(url);
    if (!key) return Promise.resolve(null);
    const current = inflight.get(key);
    if (current) return current;
    const task = (async () => {
        const cached = await imageStore.getItem<Blob>(key).catch(() => null);
        if (cached instanceof Blob && cached.size > 0) return cached;
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const blob = await response.blob();
            if (!blob.size) return null;
            await imageStore.setItem(key, blob).catch(() => undefined);
            return blob;
        } catch {
            return null;
        }
    })();
    inflight.set(key, task);
    void task.finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
    });
    return task;
}

/**
 * 优先返回本地缓存的公告图片 Object URL，缓存拉取失败或未就绪时自动回退原始地址。
 */
export function useCachedNotificationImage(url?: string | null): string {
    const normalized = url?.trim() || "";
    const [resolvedUrl, setResolvedUrl] = useState(normalized);

    useEffect(() => {
        if (!normalized) {
            setResolvedUrl("");
            return;
        }
        // 非 http(s) 地址（如 data:/blob:）直接使用，无需重复缓存
        if (!/^https?:\/\//i.test(normalized)) {
            setResolvedUrl(normalized);
            return;
        }
        let active = true;
        let objectUrl = "";
        setResolvedUrl(normalized);
        void loadCachedNotificationImage(normalized).then((blob) => {
            if (!active || !blob) return;
            objectUrl = URL.createObjectURL(blob);
            setResolvedUrl(objectUrl);
        });
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [normalized]);

    return resolvedUrl;
}
