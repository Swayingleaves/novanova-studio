"use client";

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

const resolvedUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
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
        },
        input instanceof File ? input.name : "image.png",
    );
    resolvedUrls.set(media.storageKey, media.url);
    return { url: media.url, storageKey: media.storageKey, width: media.width || meta.width, height: media.height || meta.height, bytes: media.bytes || blob.size, mimeType: media.mimeType || blob.type || meta.mimeType, objectStorage: media.objectStorage };
}

export async function reuseOrUploadImage(input: ReusableImage): Promise<UploadedImage> {
    if (!input.storageKey) return uploadImage(input.dataUrl);
    const hasWidth = isPositiveDimension(input.width);
    const hasHeight = isPositiveDimension(input.height);
    const meta = hasWidth && hasHeight && input.mimeType ? undefined : await readImageMeta(input.dataUrl);
    const image: UploadedImage = {
        url: input.dataUrl,
        storageKey: input.storageKey,
        width: hasWidth ? input.width : meta!.width,
        height: hasHeight ? input.height : meta!.height,
        bytes: input.bytes ?? 0,
        mimeType: input.mimeType || meta!.mimeType,
        ...(input.objectStorage ? { objectStorage: input.objectStorage } : {}),
    };
    resolvedUrls.set(image.storageKey, image.url);
    return image;
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = resolvedUrls.get(storageKey);
    if (cached) return cached;
    try {
        const media = await getServerMediaInfo(storageKey);
        if (!media.url) return fallback;
        resolvedUrls.set(storageKey, media.url);
        return media.url;
    } catch {
        return fallback;
    }
}

export async function resolveImageStorageInfo(storageKey?: string, fallbackUrl = "", fallbackObjectStorage?: ObjectStorageFile) {
    if (!storageKey) return mergeMediaStorageInfo(fallbackUrl, fallbackObjectStorage);
    try {
        const media = await getServerMediaInfo(storageKey);
        if (media.url) resolvedUrls.set(storageKey, media.url);
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
    resolvedUrls.set(storageKey, media.url);
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
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

function isPositiveDimension(value: number | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
