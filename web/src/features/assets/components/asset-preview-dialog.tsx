"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { Button, Modal, Tag } from "antd";
import { Copy, Download } from "lucide-react";

import { formatAssetSummary } from "../lib/asset-summary";
import { useMediaUrl } from "@/shared/hooks/use-media-url";
import { useAssetCoverSource } from "./asset-cover";
import { WatermarkBadge } from "@/features/watermark/components/watermark-badge";
import type { Asset } from "../stores/use-asset-store";

export function AssetPreviewDialog({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: () => void; onDownload: () => void }) {
    const translate = useTranslation();
    const image = asset?.kind === "image" ? asset.data : undefined;
    const video = asset?.kind === "video" ? asset.data : undefined;
    const media = useMediaUrl({
        storageKey: image?.storageKey || video?.storageKey,
        objectStorage: image?.objectStorage || video?.objectStorage,
        url: image ? image.dataUrl || asset?.coverUrl : video?.url,
        kind: image ? "image" : "media",
    });
    const poster = useAssetCoverSource(video ? asset : null, Boolean(video));
    if (!asset) return null;
    const cover = image ? media.url : asset.kind === "text" ? asset.coverUrl : "";
    return (
        <Modal title={asset.title} open centered footer={null} width={820} onCancel={onClose} destroyOnHidden>
            <div className="grid gap-5 pt-1">
                {cover ? (
                    <div className="relative">
                        <img src={cover} alt={asset.title} className="max-h-[52vh] w-full rounded-lg object-contain" onError={image ? media.onError : undefined} />
                        {asset.kind === "image" ? <WatermarkBadge /> : null}
                    </div>
                ) : null}
                {video ? <video src={media.url || undefined} poster={poster} controls playsInline preload="none" className="aspect-video w-full rounded-lg bg-black" onError={media.onError} /> : null}
                {asset.kind === "text" ? <div className="studio-panel-solid whitespace-pre-wrap p-4 text-sm leading-6">{asset.data.content}</div> : null}
                {asset.kind === "image" ? <p className="studio-subtitle text-sm">{formatAssetSummary(asset, " · ")}</p> : null}
                <div className="flex flex-wrap gap-2"><Tag>{asset.kind === "image" ? translate("assets.image") : asset.kind === "video" ? translate("assets.video") : translate("assets.text")}</Tag>{asset.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div>
                {asset.note ? <p className="studio-subtitle text-sm">{translate("assets.notes_732267")}{asset.note}</p> : null}
                <div>{asset.kind === "text" ? <Button type="primary" icon={<Copy className="size-4" />} onClick={onCopy}>{translate("assets.copyText")}</Button> : <Button type="primary" icon={<Download className="size-4" />} onClick={onDownload}>{translate("assets.download")}{asset.kind === "video" ? translate("assets.video") : translate("assets.image")}</Button>}</div>
            </div>
        </Modal>
    );
}
