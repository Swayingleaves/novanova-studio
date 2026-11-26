"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play } from "lucide-react";

import { loadImageListThumbnail, loadRemoteListThumbnail } from "@/features/generation/lib/image-list-thumbnail";
import { loadVideoListCover, type VideoCoverSource } from "@/features/generation/lib/video-list-cover";
import { WatermarkBadge } from "@/features/watermark/components/watermark-badge";
import { getAssetCoverRequest } from "../lib/asset-cover-request";
import type { Asset } from "../stores/use-asset-store";

type AssetCoverProps = {
    asset: Asset;
    className: string;
    children: ReactNode;
};

/** 资产列表与选择器复用已缓存的小图，进入视口后才查询封面。 */
export function AssetCover({ asset, className, children }: AssetCoverProps) {
    const container = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [failedSource, setFailedSource] = useState<string>();
    const source = useAssetCoverSource(asset, visible);

    useEffect(() => {
        if (visible || !container.current) return;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            setVisible(true);
        });
        observer.observe(container.current);
        return () => observer.disconnect();
    }, [visible]);

    const showCover = source && source !== failedSource;
    return (
        <div className="relative" ref={container}>
            {showCover ? (
                <>
                    <img src={source} alt={asset.title} className={className} loading="lazy" decoding="async" onError={() => setFailedSource(source)} />
                    <WatermarkBadge />
                </>
            ) : children}
            {asset.kind === "video" ? (
                <span className={`pointer-events-none absolute ${showCover ? "inset-0 grid place-items-center" : "right-2 top-2"}`} aria-hidden="true">
                    <span className="grid size-10 place-items-center rounded-full bg-black/50 text-white">
                        <Play className="size-5 fill-current" />
                    </span>
                </span>
            ) : null}
        </div>
    );
}

/** 与播放器分享同一份封面缓存，组件卸载后释放临时地址。 */
export function useAssetCoverSource(asset: Asset | null, enabled: boolean) {
    const request = getAssetCoverRequest(asset);
    const kind = request?.kind;
    const key = request?.key;
    const url = request?.url;
    const identity = kind && key ? `${kind}:${key}` : "";
    const [cover, setCover] = useState<{ identity: string; source: string }>();

    useEffect(() => {
        if (!enabled || !kind || !key) return;
        let active = true;
        let objectUrl = "";
        const loadCover = async (): Promise<VideoCoverSource | null> => {
            if (kind === "video") return loadVideoListCover(key);
            const blob = kind === "imageUrl" ? await loadRemoteListThumbnail(key, url || "") : await loadImageListThumbnail(key);
            return blob ? { blob } : null;
        };
        void loadCover().then((result) => {
            if (!active || !result) return;
            if (result.blob) objectUrl = URL.createObjectURL(result.blob);
            const source = objectUrl || result.url;
            if (source) setCover({ identity, source });
        }).catch((error) => console.error("加载资产封面失败", error));
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [enabled, identity, key, kind, url]);

    return enabled && cover?.identity === identity ? cover.source : undefined;
}
