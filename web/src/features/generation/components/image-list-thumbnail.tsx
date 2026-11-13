"use client";

import { useEffect, useState } from "react";

import { MediaPreview } from "@/features/generation/components/media-fallback";
import { listThumbnailCacheKey, loadImageListThumbnail, loadRemoteListThumbnail } from "@/features/generation/lib/image-list-thumbnail";

/** 任务列表缩略图：优先读本地小图，没有时再请求缩放后的对象存储地址。 */
export function ImageListThumbnail({ storageKey, url, className }: { storageKey?: string; url?: string; className?: string }) {
    const [src, setSrc] = useState<string>();
    const remoteUrl = url?.trim();

    useEffect(() => {
        const key = listThumbnailCacheKey(storageKey, remoteUrl);
        if (!key) return;
        let active = true;
        let objectUrl = "";
        const task = remoteUrl ? loadRemoteListThumbnail(key, remoteUrl) : loadImageListThumbnail(key);
        void task.then((blob) => {
            if (!blob) return;
            const nextUrl = URL.createObjectURL(blob);
            if (!active) {
                URL.revokeObjectURL(nextUrl);
                return;
            }
            objectUrl = nextUrl;
            setSrc(nextUrl);
        });
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [storageKey, remoteUrl]);

    return <MediaPreview kind="image" src={src} className={className} />;
}
