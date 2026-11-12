"use client";

import { useEffect, useState } from "react";

import { MediaPreview } from "@/features/generation/components/media-fallback";
import { listThumbnailCacheKey } from "@/features/generation/lib/image-list-thumbnail";
import { loadRemoteVideoCover, loadVideoListCover } from "@/features/generation/lib/video-list-cover";

/** 读取已缓存或对象存储中的视频封面，并维持到组件卸载。 */
export function useVideoListCover(storageKey?: string, url?: string) {
    const remoteUrl = url?.trim();
    const [state, setState] = useState<{ ready: boolean; src?: string }>({ ready: !storageKey?.trim() && !remoteUrl });

    useEffect(() => {
        const key = listThumbnailCacheKey(storageKey, remoteUrl);
        if (!key) {
            setState({ ready: true });
            return;
        }
        let active = true;
        let objectUrl = "";
        setState({ ready: false });
        const task = remoteUrl ? loadRemoteVideoCover(key, remoteUrl) : loadVideoListCover(key);
        void task.then((source) => {
            if (!active) return;
            if (source?.blob) {
                objectUrl = URL.createObjectURL(source.blob);
                setState({ ready: true, src: objectUrl });
                return;
            }
            setState({ ready: true, src: source?.url || undefined });
        });
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [storageKey, remoteUrl]);

    return state;
}

/** 视频任务列表封面。没有封面时展示占位图，不读取原视频。 */
export function VideoListCover({ storageKey, url, className }: { storageKey?: string; url?: string; className?: string }) {
    const cover = useVideoListCover(storageKey, url);
    return <MediaPreview kind="image" src={cover.src} className={className} />;
}
