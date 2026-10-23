"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { Asset } from "../stores/use-asset-store";

type AssetCoverProps = {
    asset: Asset;
    className: string;
    children: ReactNode;
};

/** 资产封面：图片取自身图，视频显示首帧并叠加播放标记，其余情况展示调用方兜底内容。 */
export function AssetCover({ asset, className, children }: AssetCoverProps) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [asset.id, asset.updatedAt]);
    const image = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    if (image) return <img src={image} alt={asset.title} className={className} />;
    if (asset.kind === "video" && asset.data.url && !failed) {
        return (
            <span className="relative block">
                <video src={videoFirstFrameSrc(asset.data.url)} aria-label={asset.title} muted playsInline preload="metadata" className={className} onError={() => setFailed(true)} />
                <span className="pointer-events-none absolute inset-0 grid place-items-center text-2xl text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">▶</span>
            </span>
        );
    }
    return <>{children}</>;
}

/** 追加媒体片段定位到 0.1 秒，避免部分视频首帧是黑场。 */
function videoFirstFrameSrc(url: string) {
    return `${url.split("#")[0]}#t=0.1`;
}
