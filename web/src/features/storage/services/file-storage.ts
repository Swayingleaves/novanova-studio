"use client";

import { nanoid } from "nanoid";

import { deleteServerMedia, downloadServerMedia, getServerMediaInfo, registerRemoteMedia, uploadServerMedia } from "@/services/api/server";
import type { ObjectStorageFile } from "@/shared/types/object-storage";
import { mergeMediaStorageInfo } from "./media-storage-info";

export type UploadedFile = { url: string; sourceUrl?: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; objectStorage?: ObjectStorageFile };

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

export async function uploadMediaFile(input: string | Blob, prefix = "file", options: { mimeType?: string; durationMs?: number } = {}): Promise<UploadedFile> {
    if (typeof input === "string" && /^https?:\/\//i.test(input)) {
        const media = await registerRemoteMedia({ kind: prefix, sourceUrl: input, storageKey: `${prefix}:${nanoid()}`, mimeType: options.mimeType });
        return { url: media.url || input, sourceUrl: media.sourceUrl || input, storageKey: media.storageKey, bytes: media.bytes || 0, mimeType: media.mimeType || options.mimeType || "application/octet-stream", width: media.width, height: media.height, durationMs: media.durationMs, objectStorage: media.objectStorage };
    }
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const localUrl = URL.createObjectURL(blob);
    const meta: Partial<{ width: number; height: number; durationMs: number }> = blob.type.startsWith("video/") ? await readVideoMeta(localUrl) : {};
    URL.revokeObjectURL(localUrl);
    const storageKey = `${prefix}:${nanoid()}`;
    const media = await uploadServerMedia(
        blob,
        {
            kind: prefix,
            storageKey,
            mimeType: options.mimeType || blob.type || "application/octet-stream",
            ...meta,
            ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
        },
        input instanceof File ? input.name : `${prefix}.bin`,
    );
    writeCachedUrl(media.storageKey, media.url, media.expiresAt);
    return { url: media.url, sourceUrl: media.sourceUrl, storageKey: media.storageKey, bytes: media.bytes || blob.size, mimeType: media.mimeType || options.mimeType || blob.type || "application/octet-stream", width: media.width || meta.width, height: media.height || meta.height, durationMs: media.durationMs || options.durationMs || meta.durationMs, objectStorage: media.objectStorage };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "", forceRefresh = false) {
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

export async function resolveMediaStorageInfo(storageKey?: string, fallbackUrl = "", fallbackObjectStorage?: ObjectStorageFile) {
    if (!storageKey) return mergeMediaStorageInfo(fallbackUrl, fallbackObjectStorage);
    try {
        const media = await getServerMediaInfo(storageKey);
        if (media.url) writeCachedUrl(storageKey, media.url, media.expiresAt);
        return mergeMediaStorageInfo(fallbackUrl, fallbackObjectStorage, media);
    } catch {
        return mergeMediaStorageInfo(fallbackUrl, fallbackObjectStorage);
    }
}

export async function getMediaBlob(storageKey: string) {
    if (!storageKey) return null;
    return downloadServerMedia(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    const audioMeta = blob.type.startsWith("audio/") ? await (await import("./audio-storage")).readAudioMetadata(blob) : null;
    const localUrl = URL.createObjectURL(blob);
    const meta = audioMeta ? { durationMs: audioMeta.durationMs } : blob.type.startsWith("video/") ? await readVideoMeta(localUrl) : {};
    URL.revokeObjectURL(localUrl);
    const media = await uploadServerMedia(blob, { kind: storageKey.split(":", 1)[0] || "file", storageKey, mimeType: blob.type || "application/octet-stream", ...meta }, "media.bin");
    writeCachedUrl(storageKey, media.url, media.expiresAt);
    return media.url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    const storageKeys = Array.from(new Set(keys)).filter(Boolean);
    storageKeys.forEach((key) => resolvedUrls.delete(key));
    if (storageKeys.length) await deleteServerMedia(storageKeys);
}

export async function cleanupUnusedMedia(_usedData: unknown) {
    // 后端媒体清理需要引用关系分析，当前只在明确删除业务记录时删除对应元数据。
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}
