"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { Button, Tag } from "antd";
import { Copy, Download, PencilLine, Trash2 } from "lucide-react";

import { formatBytes } from "@/features/generation/lib/image-utils";
import { AssetCover } from "./asset-cover";
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
    const translate = useTranslation();
    return (
        <article className="studio-panel-solid overflow-hidden">
            <button type="button" className="block w-full text-left" onClick={onPreview}>
                <AssetCover asset={asset} className="aspect-[4/3] w-full object-cover">
                    <div className="studio-empty relative aspect-[4/3] overflow-hidden">
                        <div className="absolute inset-0 flex items-center justify-center p-5 text-center text-sm leading-6">
                            <span className="line-clamp-6 w-full break-words">{asset.kind === "text" ? asset.data.content : translate("assets.noCover")}</span>
                        </div>
                    </div>
                </AssetCover>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="studio-title truncate text-sm font-semibold">{asset.title}</h2><p className="studio-caption mt-1 text-xs">{asset.source || translate("assets.noSource")}</p></div><Tag className="m-0 shrink-0">{assetKindLabel(asset)}</Tag></div>
                    <p className="studio-subtitle mt-2 line-clamp-3 text-xs leading-5">{assetSummary(asset)}</p>
                    <div className="mt-3 flex flex-wrap gap-1">{asset.tags.length ? asset.tags.slice(0, 3).map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>) : <Tag className="m-0 text-[11px]">{translate("assets.noTags_c25b85")}</Tag>}</div>
                </div>
            </button>
            <footer className="flex flex-wrap gap-1 px-4 pb-4">
                <Button size="small" onClick={onPreview}>{translate("assets.view")}</Button>
                {asset.kind !== "video" ? <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>{translate("assets.edit")}</Button> : null}
                {asset.kind === "text" ? <Button size="small" icon={<Copy className="size-3.5" />} onClick={onCopy}>{translate("assets.copy")}</Button> : null}
                {asset.kind !== "text" ? <Button size="small" icon={<Download className="size-3.5" />} onClick={onDownload}>{translate("assets.download")}</Button> : null}
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>{translate("assets.delete")}</Button>
            </footer>
        </article>
    );
}

function assetSummary(asset: Asset): string {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width} × ${asset.data.height}，${formatBytes(asset.data.bytes) || translate("assets.unknownSize")}，${asset.data.mimeType}`;
}

function assetKindLabel(asset: Asset): string {
    return asset.kind === "image" ? translate("assets.image") : asset.kind === "video" ? translate("assets.video") : translate("assets.text");
}
