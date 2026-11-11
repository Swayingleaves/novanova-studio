"use client";

import { useEffect, useState } from "react";

import { MediaPreview } from "@/features/generation/components/media-fallback";
import { loadImageListThumbnail } from "@/features/generation/lib/image-list-thumbnail";

/** 任务列表缩略图：优先读本地小图，没有时再请求缩放后的对象存储地址。 */
export function ImageListThumbnail({ storageKey, className }: { storageKey?: string; className?: string }) {
    const [src, setSrc] = useState<string>();

    useEffect(() => {
        const key = storageKey?.trim();
        if (!key) return;
        let active = true;
        let objectUrl = "";
        void loadImageListThumbnail(key).then((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            if (!active) {
                URL.revokeObjectURL(url);
                return;
            }
            objectUrl = url;
            setSrc(url);
        });
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [storageKey]);

    return <MediaPreview kind="image" src={src} className={className} />;
}
