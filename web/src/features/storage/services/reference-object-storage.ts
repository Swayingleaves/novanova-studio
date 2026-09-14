"use client";

import { getImageBlob } from "@/features/storage/services/image-storage";
import { uploadObjectToStorage, uploadRemoteObjectToStorage } from "@/features/storage/services/object-storage";
import type { ReferenceImage } from "@/features/generation/types/image";
import type { ReferenceAudio } from "@/features/generation/types/media";

export function findMissingReferenceObjectStorageImages(references: ReferenceImage[]) {
    return references.filter((image) => !image.objectStorage?.url);
}

export async function uploadMissingReferenceImagesToObjectStorage(references: ReferenceImage[]) {
    const uploadedById = new Map<string, ReferenceImage>();
    const missing = findMissingReferenceObjectStorageImages(references);
    await Promise.all(
        missing.map(async (image, index) => {
            const remoteSource = resolveRemoteReferenceSource(image);
            if (remoteSource) {
                const objectStorage = await uploadRemoteObjectToStorage({
                    ...remoteSource,
                    kind: "image",
                    mimeType: image.type,
                });
                uploadedById.set(image.id, { ...image, objectStorage });
                return;
            }
            const blob = await readReferenceImageBlob(image);
            if (!blob) throw new Error(`${image.name || `参考图${index + 1}`}读取失败，请重新添加后再生成视频`);
            const objectStorage = await uploadObjectToStorage({
                body: blob,
                kind: "image",
                fileName: image.name || `reference-${index + 1}.png`,
                mimeType: image.type || blob.type || "image/png",
            });
            uploadedById.set(image.id, { ...image, objectStorage });
        }),
    );
    return references.map((image) => uploadedById.get(image.id) || image);
}

/** 查找未上传到对象存储的参考音频。 */
export function findMissingReferenceObjectStorageAudios(references: ReferenceAudio[]) {
    return references.filter((audio) => !/^https?:\/\//i.test(audio.objectStorage?.url || ""));
}

/** 将缺少对象存储地址的参考音频转存，并保留裁剪区间。 */
export async function uploadMissingReferenceAudiosToObjectStorage(references: ReferenceAudio[]) {
    const missing = findMissingReferenceObjectStorageAudios(references);
    const uploadedById = new Map<string, ReferenceAudio>();
    await Promise.all(
        missing.map(async (audio, index) => {
            if (!audio.storageKey || !audio.url) {
                throw new Error(`${audio.name || `参考音频${index + 1}`}缺少已上传媒体，无法转存到云储存`);
            }
            const objectStorage = await uploadRemoteObjectToStorage({ storageKey: audio.storageKey, sourceUrl: audio.url, kind: "audio", mimeType: audio.type });
            uploadedById.set(audio.id, { ...audio, objectStorage });
        }),
    );
    return references.map((audio) => uploadedById.get(audio.id) || audio);
}

function resolveRemoteReferenceSource(image: ReferenceImage) {
    const sourceUrl = [image.dataUrl, image.url].find((url) => /^https?:\/\//i.test(url || "")) || "";
    return image.storageKey || sourceUrl ? { storageKey: image.storageKey, sourceUrl } : null;
}

async function readReferenceImageBlob(image: ReferenceImage) {
    if (image.storageKey) return getImageBlob(image.storageKey);
    const url = image.dataUrl || image.url;
    if (!url) return null;
    return (await fetch(url)).blob();
}
