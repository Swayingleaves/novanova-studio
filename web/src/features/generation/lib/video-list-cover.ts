import localforage from "localforage";

import { fitThumbnailSize } from "@/features/generation/lib/image-list-thumbnail";
import { teamStorageKey } from "@/features/team/stores/use-team-store";
import { batchGetServerVideoCoverAccess } from "@/services/api/server";

const coverStore = localforage.createInstance({
    name: "novanova-studio",
    storeName: "video_list_covers",
});

/** 封面展示来源。blob 是本地缓存；url 是对象存储临时地址，脚本读不到字节时仍可直接给图片标签使用。 */
export type VideoCoverSource = { blob?: Blob; url?: string };

type PendingCover = { storageKey: string; resolve: (source: VideoCoverSource | null) => void };

const pending: PendingCover[] = [];
const inflight = new Map<string, Promise<VideoCoverSource | null>>();
let scheduled = false;

/**
 * 读取视频封面。本地已有时不再访问对象存储；没有封面的历史视频返回空。
 */
export function loadVideoListCover(storageKey: string): Promise<VideoCoverSource | null> {
    const key = storageKey.trim();
    if (!key) return Promise.resolve(null);
    const current = inflight.get(key);
    if (current) return current;
    const task = new Promise<VideoCoverSource | null>((resolve) => {
        pending.push({ storageKey: key, resolve });
        if (!scheduled) {
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                const batch = pending.splice(0);
                void resolveCoverBatch(batch);
            }, 0);
        }
    });
    inflight.set(key, task);
    void task.finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
    });
    return task;
}

async function resolveCoverBatch(batch: PendingCover[]) {
    const grouped = new Map<string, PendingCover[]>();
    for (const item of batch) {
        const items = grouped.get(item.storageKey) || [];
        items.push(item);
        grouped.set(item.storageKey, items);
    }
    const deliver = (storageKey: string, source: VideoCoverSource | null) => {
        for (const item of grouped.get(storageKey) || []) item.resolve(source);
    };
    const missing: string[] = [];
    await Promise.all([...grouped.keys()].map(async (storageKey) => {
        const cached = await coverStore.getItem<Blob>(teamStorageKey(storageKey)).catch(() => null);
        if (cached instanceof Blob && cached.size > 0) {
            deliver(storageKey, { blob: cached });
            return;
        }
        missing.push(storageKey);
    }));
    if (!missing.length) return;
    let urls = new Map<string, string>();
    try {
        const result = await batchGetServerVideoCoverAccess(missing);
        urls = new Map(result.items.map((item) => [item.storageKey, item.url]));
    } catch (error) {
        console.error("获取视频封面地址失败", error);
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
                deliver(storageKey, { url });
                return;
            }
            const shrunk = await shrinkCover(await response.blob());
            if (!shrunk?.size) {
                deliver(storageKey, { url });
                return;
            }
            await coverStore.setItem(teamStorageKey(storageKey), shrunk).catch(() => undefined);
            deliver(storageKey, { blob: shrunk, url });
        } catch {
            deliver(storageKey, { url });
        }
    }));
}

async function shrinkCover(blob: Blob): Promise<Blob | null> {
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
