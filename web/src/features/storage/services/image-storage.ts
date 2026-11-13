"use client";
import { translateMessage as translate } from "@/features/locale/translate";


import { nanoid } from "nanoid";

import { readImageMeta } from "@/features/generation/lib/image-utils";
import { deleteServerMedia, downloadServerMedia, getServerMediaInfo, registerRemoteMedia, uploadServerMedia } from "@/services/api/server";
import type { ObjectStorageFile } from "@/shared/types/object-storage";
import { mergeMediaStorageInfo } from "./media-storage-info";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    objectStorage?: ObjectStorageFile;
};

type ReusableImage = {
    dataUrl: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    objectStorage?: ObjectStorageFile;
};

const resolvedUrls = new Map<string, { url: string; expiresAt?: number }>();

/** 预签名地址提前一分钟视为过期，避免页面拿到即将失效的地址。 */
const URL_REUSE_MARGIN_MS = 60_000;

function readCachedUrl(storageKey: string) {
    const cached = resolvedUrls.get(storageKey);
    if (!cached) return "";
    if (cached.expiresAt && cached.expiresAt - URL_REUSE_MARGIN_MS <= Date.now()) {
        resolvedUrls.delete(storageKey);
        return "";
    }
    return cached.url;
}

function writeCachedUrl(storageKey: string, url: string, expiresAt?: string) {
    resolvedUrls.set(storageKey, { url, expiresAt: expiresAt ? Date.parse(expiresAt) : undefined });
}

export async function uploadImage(input: string | Blob, options?: { compress?: boolean }): Promise<UploadedImage> {
    if (typeof input === "string" && /^https?:\/\//i.test(input)) {
        const meta = await readImageMeta(input);
        const media = await registerRemoteMedia({ kind: "image", sourceUrl: input, mimeType: meta.mimeType, width: meta.width, height: meta.height });
        return { url: media.url || input, storageKey: media.storageKey, width: media.width || meta.width, height: media.height || meta.height, bytes: media.bytes || 0, mimeType: media.mimeType || meta.mimeType, objectStorage: media.objectStorage };
    }

    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const localUrl = URL.createObjectURL(blob);
    const meta = await readImageMeta(localUrl);
    URL.revokeObjectURL(localUrl);
    const storageKey = `image:${nanoid()}`;
    const media = await uploadServerMedia(
        blob,
        {
            kind: "image",
            storageKey,
            mimeType: blob.type || meta.mimeType,
            width: meta.width,
            height: meta.height,
            compress: options?.compress,
        },
        input instanceof File ? input.name : "image.png",
    );
    writeCachedUrl(media.storageKey, media.url, media.expiresAt);
    return { url: media.url, storageKey: media.storageKey, width: media.width || meta.width, height: media.height || meta.height, bytes: media.bytes || blob.size, mimeType: media.mimeType || blob.type || meta.mimeType, objectStorage: media.objectStorage };
}

export async function reuseOrUploadImage(input: ReusableImage): Promise<UploadedImage> {
    if (!input.storageKey) return uploadImage(input.dataUrl);
    const { width, height } = input;
    const hasWidth = isPositiveDimension(width);
    const hasHeight = isPositiveDimension(height);
    const meta = hasWidth && hasHeight && input.mimeType ? undefined : await readImageMeta(input.dataUrl);
    const image: UploadedImage = {
        url: await resolveImageUrl(input.storageKey, input.dataUrl),
        storageKey: input.storageKey,
        width: hasWidth ? width : meta!.width,
        height: hasHeight ? height : meta!.height,
        bytes: input.bytes ?? 0,
        mimeType: input.mimeType || meta!.mimeType,
        ...(input.objectStorage ? { objectStorage: input.objectStorage } : {}),
    };
    return image;
}

export async function resolveImageUrl(storageKey?: string, fallback = "", forceRefresh = false) {
    if (!storageKey) return fallback;
    if (!forceRefresh) {
        const cached = readCachedUrl(storageKey);
        if (cached) return cached;
    }
    try {
        const media = await getServerMediaInfo(storageKey);
        if (!media.url) return fallback;
        writeCachedUrl(storageKey, media.url, media.expiresAt);
        return media.url;
    } catch {
        return fallback;
    }
}

export async function resolveImageStorageInfo(storageKey?: string, fallbackUrl = "", fallbackObjectStorage?: ObjectStorageFile) {
    if (!storageKey) return mergeMediaStorageInfo(fallbackUrl, fallbackObjectStorage);
    try {
        const media = await getServerMediaInfo(storageKey);
        if (media.url) writeCachedUrl(storageKey, media.url, media.expiresAt);
        return mergeMediaStorageInfo(fallbackUrl, fallbackObjectStorage, media);
    } catch {
        return mergeMediaStorageInfo(fallbackUrl, fallbackObjectStorage);
    }
}

export async function getImageBlob(storageKey: string) {
    if (!storageKey) return null;
    return downloadServerMedia(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    const localUrl = URL.createObjectURL(blob);
    const meta = await readImageMeta(localUrl);
    URL.revokeObjectURL(localUrl);
    const media = await uploadServerMedia(blob, { kind: "image", storageKey, mimeType: blob.type || meta.mimeType, width: meta.width, height: meta.height }, "image.png");
    writeCachedUrl(storageKey, media.url, media.expiresAt);
    return media.url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    if (image.dataUrl) return image.dataUrl;
    if (image.storageKey) {
        const blob = await getImageBlob(image.storageKey);
        return blob ? blobToDataUrl(blob) : undefined;
    }
    const url = image.url || "";
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    const storageKeys = Array.from(new Set(keys)).filter(Boolean);
    storageKeys.forEach((key) => resolvedUrls.delete(key));
    if (storageKeys.length) await deleteServerMedia(storageKeys);
}

export async function cleanupUnusedImages(_usedData: unknown) {
    // 后端媒体清理需要引用关系分析，当前只在明确删除业务记录时删除对应元数据。
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(translate("storage.failedToReadImage")));
        reader.readAsDataURL(blob);
    });
}

function isPositiveDimension(value: number | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
