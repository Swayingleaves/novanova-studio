"use client";

import { getImageBlob } from "@/features/storage/services/image-storage";
import { uploadObjectToStorage, uploadRemoteObjectToStorage } from "@/features/storage/services/object-storage";
import type { ReferenceImage } from "@/features/generation/types/image";

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
