"use client";

import { Button, Tag } from "antd";
import { Copy, Download, PencilLine, Trash2 } from "lucide-react";

import { formatBytes } from "@/features/generation/lib/image-utils";
import type { Asset } from "../stores/use-asset-store";

type AssetLibraryCardProps = {
    asset: Asset;
    onPreview: () => void;
    onEdit: () => void;
    onCopy: () => void;
    onDownload: () => void;
    onDelete: () => void;
};

export function AssetLibraryCard({ asset, onPreview, onEdit, onCopy, onDownload, onDelete }: AssetLibraryCardProps) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    return (
        <article className="studio-panel-solid overflow-hidden">
            <button type="button" className="block w-full text-left" onClick={onPreview}>
                {cover ? <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" /> : <div className="studio-empty flex aspect-[4/3] items-center justify-center p-5 text-center text-sm leading-6">{asset.kind === "text" ? asset.data.content : "暂无封面"}</div>}
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="studio-title truncate text-sm font-semibold">{asset.title}</h2><p className="studio-caption mt-1 text-xs">{asset.source || "未标注来源"}</p></div><Tag className="m-0 shrink-0">{assetKindLabel(asset)}</Tag></div>
                    <p className="studio-subtitle mt-2 line-clamp-3 text-xs leading-5">{assetSummary(asset)}</p>
                    <div className="mt-3 flex flex-wrap gap-1">{asset.tags.length ? asset.tags.slice(0, 3).map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>) : <Tag className="m-0 text-[11px]">无标签</Tag>}</div>
                </div>
            </button>
            <footer className="flex flex-wrap gap-1 px-4 pb-4">
                <Button size="small" onClick={onPreview}>查看</Button>
                {asset.kind !== "video" ? <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>编辑</Button> : null}
                {asset.kind === "text" ? <Button size="small" icon={<Copy className="size-3.5" />} onClick={onCopy}>复制</Button> : null}
                {asset.kind !== "text" ? <Button size="small" icon={<Download className="size-3.5" />} onClick={onDownload}>下载</Button> : null}
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>删除</Button>
            </footer>
        </article>
    );
}

function assetSummary(asset: Asset): string {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width} × ${asset.data.height}，${formatBytes(asset.data.bytes) || "大小未知"}，${asset.data.mimeType}`;
}

function assetKindLabel(asset: Asset): string {
    return asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "文本";
}
