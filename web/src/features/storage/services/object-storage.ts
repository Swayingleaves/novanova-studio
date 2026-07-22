"use client";

import { registerRemoteMedia, testObjectStorage, uploadRemoteMediaToObjectStorage, uploadServerMedia } from "@/services/api/server";
import type { ObjectStorageConfig, ObjectStorageFile } from "@/shared/types/object-storage";

type ObjectStorageUploadKind = "image" | "video";
type UploadObjectInput = {
    body: Blob;
    kind: ObjectStorageUploadKind;
    fileName?: string;
    mimeType?: string;
};

export function isObjectStorageReady(config: ObjectStorageConfig) {
    if (!config.accessKey.trim() || !config.secretKey.trim() || !config.bucket.trim() || !config.region.trim()) return false;
    if (config.provider === "aliyunOss") return Boolean(config.endpoint.trim());
    return config.provider !== "qiniuKodo" || Boolean(config.publicBaseUrl.trim());
}

export async function uploadObjectToStorage(input: UploadObjectInput): Promise<ObjectStorageFile> {
    const media = await uploadServerMedia(
        input.body,
        {
            kind: input.kind,
            mimeType: input.mimeType || input.body.type || (input.kind === "image" ? "image/png" : "video/mp4"),
        },
        input.fileName || (input.kind === "image" ? "image.png" : "video.mp4"),
    );
    if (!media.objectStorage) throw new Error("后端没有返回对象存储文件信息");
    return media.objectStorage;
}

export async function uploadRemoteObjectToStorage(
    input: { storageKey?: string; sourceUrl: string; kind: ObjectStorageUploadKind; mimeType?: string },
): Promise<ObjectStorageFile> {
    const storageKey = input.storageKey?.trim()
        ? input.storageKey.trim()
        : (await registerRemoteMedia({ kind: input.kind, sourceUrl: input.sourceUrl, mimeType: input.mimeType })).storageKey;
    const media = await uploadRemoteMediaToObjectStorage(storageKey);
    if (!media.objectStorage) throw new Error("后端没有返回对象存储文件信息");
    return media.objectStorage;
}

export async function testObjectStorageUpload(config: ObjectStorageConfig) {
    if (!isObjectStorageReady(config)) throw new Error(objectStorageReadyMessage(config));
    return testObjectStorage(config);
}

export function buildObjectStoragePublicUrl(config: ObjectStorageConfig, key: string) {
    const baseUrl = config.publicBaseUrl.trim().replace(/\/+$/, "");
    const path = key
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    if (baseUrl) return `${baseUrl}/${path}`;
    if (config.provider === "tencentCos") return `https://${config.bucket.trim()}.cos.${config.region.trim()}.myqcloud.com/${path}`;
    if (config.provider === "aliyunOss") {
        const endpoint = new URL(config.endpoint.trim());
        return `${endpoint.protocol}//${config.bucket.trim()}.${endpoint.host}/${path}`;
    }
    throw new Error("七牛云Kodo必须填写公开访问地址");
}

export function objectStorageReadyMessage(config?: ObjectStorageConfig) {
    if (!config) return "对象存储不存在";
    if (!config.accessKey.trim() || !config.secretKey.trim() || !config.bucket.trim() || !config.region.trim()) {
        return "请完整填写访问密钥、密钥、Bucket 和 Region";
    }
    if (config.provider === "aliyunOss" && !config.endpoint.trim()) return "请填写阿里云OSS Endpoint";
    if (config.provider === "qiniuKodo" && !config.publicBaseUrl.trim()) return "请填写七牛云Kodo公开访问地址";
    return "对象存储配置不完整";
}
