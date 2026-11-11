"use client";

import { useEffect, useState } from "react";

import { MediaPreview } from "@/features/generation/components/media-fallback";
import { loadVideoListCover } from "@/features/generation/lib/video-list-cover";

/** 读取已缓存或对象存储中的视频封面，并维持到组件卸载。 */
export function useVideoListCover(storageKey?: string) {
    const [state, setState] = useState<{ ready: boolean; src?: string }>({ ready: !storageKey?.trim() });

    useEffect(() => {
        const key = storageKey?.trim();
        if (!key) {
            setState({ ready: true });
            return;
        }
        let active = true;
        let objectUrl = "";
        setState({ ready: false });
        void loadVideoListCover(key).then((source) => {
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
    }, [storageKey]);

    return state;
}

/** 视频任务列表封面。没有封面时展示占位图，不读取原视频。 */
export function VideoListCover({ storageKey, className }: { storageKey?: string; className?: string }) {
    const cover = useVideoListCover(storageKey);
    return <MediaPreview kind="image" src={cover.src} className={className} />;
}
