import type { ObjectStorageFile } from "@/shared/types/object-storage";

export type GeneratedImageResult = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    objectStorage?: ObjectStorageFile;
};

export function normalizeImageTaskResult(resultData: unknown, createId: () => string): GeneratedImageResult[] {
    const candidates = readCandidates(resultData);
    const images = candidates.filter(isImageResult).map((item) => toGeneratedImageResult(item, createId));
    if (images.length === 0) throw new Error("图片任务已完成，但没有返回图片");
    return images;
}

function readCandidates(resultData: unknown): unknown[] {
    if (typeof resultData !== "object" || resultData === null) return [];
    const result = resultData as { items?: unknown; item?: unknown };
    if (Array.isArray(result.items)) return result.items;
    return result.item === undefined ? [] : [result.item];
}

function isImageResult(value: unknown): value is ImageTaskResultItem {
    return typeof value === "object" && value !== null && typeof (value as { url?: unknown }).url === "string" && Boolean((value as { url: string }).url.trim());
}

type ImageTaskResultItem = {
    url: string;
    storageKey?: unknown;
    width?: unknown;
    height?: unknown;
    bytes?: unknown;
    mimeType?: unknown;
    objectStorage?: unknown;
};

function toGeneratedImageResult(item: ImageTaskResultItem, createId: () => string): GeneratedImageResult {
    const result: GeneratedImageResult = { id: createId(), dataUrl: item.url };
    if (typeof item.storageKey === "string" && item.storageKey.trim()) result.storageKey = item.storageKey;
    if (typeof item.width === "number" && Number.isFinite(item.width)) result.width = item.width;
    if (typeof item.height === "number" && Number.isFinite(item.height)) result.height = item.height;
    if (typeof item.bytes === "number" && Number.isFinite(item.bytes)) result.bytes = item.bytes;
    if (typeof item.mimeType === "string" && item.mimeType.trim()) result.mimeType = item.mimeType;
    if (typeof item.objectStorage === "object" && item.objectStorage !== null) result.objectStorage = item.objectStorage as ObjectStorageFile;
    return result;
}
