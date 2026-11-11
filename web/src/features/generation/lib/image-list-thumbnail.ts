import localforage from "localforage";

import { teamStorageKey } from "@/features/team/stores/use-team-store";
import { batchGetServerListThumbnailAccess } from "@/services/api/server";

/** 列表缩略图长边。和对象存储读取时的缩放保持一致，约等于 40px 展示的四倍。 */
export const IMAGE_LIST_THUMBNAIL_EDGE = 160;

const thumbnailStore = localforage.createInstance({
    name: "novanova-studio",
    storeName: "image_list_thumbnails",
});

type PendingThumbnail = { storageKey: string; resolve: (blob: Blob | null) => void };

const pending: PendingThumbnail[] = [];
const inflight = new Map<string, Promise<Blob | null>>();
let scheduled = false;

/** 把图片限制在列表缩略图长边以内，不放大小图。 */
export function fitThumbnailSize(width: number, height: number, edge = IMAGE_LIST_THUMBNAIL_EDGE) {
    const longest = Math.max(width, height);
    if (width < 1 || height < 1 || longest <= edge) {
        return { width: Math.max(1, Math.round(width) || 1), height: Math.max(1, Math.round(height) || 1) };
    }
    const scale = edge / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 读取任务列表缩略图。本地已有小图时不再访问对象存储；没有时同一帧内的多个存储键合并成一次地址请求。
 */
export function loadImageListThumbnail(storageKey: string): Promise<Blob | null> {
    const key = storageKey.trim();
    if (!key) return Promise.resolve(null);
    const current = inflight.get(key);
    if (current) return current;
    const task = new Promise<Blob | null>((resolve) => {
        pending.push({ storageKey: key, resolve });
        if (!scheduled) {
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                const batch = pending.splice(0);
                void resolveThumbnailBatch(batch);
            }, 0);
        }
    });
    inflight.set(key, task);
    void task.finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
    });
    return task;
}

async function resolveThumbnailBatch(batch: PendingThumbnail[]) {
    const grouped = new Map<string, PendingThumbnail[]>();
    for (const item of batch) {
        const items = grouped.get(item.storageKey) || [];
        items.push(item);
        grouped.set(item.storageKey, items);
    }
    const deliver = (storageKey: string, blob: Blob | null) => {
        for (const item of grouped.get(storageKey) || []) item.resolve(blob);
    };
    const missing: string[] = [];
    await Promise.all([...grouped.keys()].map(async (storageKey) => {
        const cached = await thumbnailStore.getItem<Blob>(teamStorageKey(storageKey)).catch(() => null);
        if (cached instanceof Blob && cached.size > 0) {
            deliver(storageKey, cached);
            return;
        }
        missing.push(storageKey);
    }));
    if (!missing.length) return;
    let urls = new Map<string, string>();
    try {
        const result = await batchGetServerListThumbnailAccess(missing);
        urls = new Map(result.items.map((item) => [item.storageKey, item.url]));
    } catch (error) {
        console.error("获取列表缩略图地址失败", error);
        missing.forEach((storageKey) => deliver(storageKey, null));
        return;
    }
    await Promise.all(missing.map(async (storageKey) => {
        const url = urls.get(storageKey)?.trim();
        if (!url) {
            deliver(storageKey, null);
            return;
        }
        try {
            const response = await fetch(url);
            if (!response.ok) {
                deliver(storageKey, null);
                return;
            }
            const shrunk = await shrinkThumbnail(await response.blob());
            if (!shrunk?.size) {
                deliver(storageKey, null);
                return;
            }
            await thumbnailStore.setItem(teamStorageKey(storageKey), shrunk).catch(() => undefined);
            deliver(storageKey, shrunk);
        } catch (error) {
            console.error("读取列表缩略图失败", storageKey, error);
            deliver(storageKey, null);
        }
    }));
}

async function shrinkThumbnail(blob: Blob): Promise<Blob | null> {
    if (!blob.size) return null;
    const bitmap = await createImageBitmap(blob);
    const size = fitThumbnailSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        return null;
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob((output) => resolve(output), "image/jpeg", 0.8));
}
