"use client";
import { useTranslation } from "@/features/locale/use-translation";


import { Button, Modal, Tag } from "antd";
import { Copy, Download } from "lucide-react";

import { formatBytes } from "@/features/generation/lib/image-utils";
import type { Asset } from "../stores/use-asset-store";

export function AssetPreviewDialog({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: () => void; onDownload: () => void }) {
    const translate = useTranslation();
    if (!asset) return null;
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    return (
        <Modal title={asset.title} open centered footer={null} width={820} onCancel={onClose} destroyOnHidden>
            <div className="grid gap-5 pt-1">
                {cover ? <img src={cover} alt={asset.title} className="max-h-[52vh] w-full rounded-lg object-contain" /> : null}
                {asset.kind === "video" ? <video src={asset.data.url} controls className="aspect-video w-full rounded-lg bg-black" /> : null}
                {asset.kind === "text" ? <div className="studio-panel-solid whitespace-pre-wrap p-4 text-sm leading-6">{asset.data.content}</div> : null}
                {asset.kind === "image" ? <p className="studio-subtitle text-sm">{asset.data.width} × {asset.data.height} · {formatBytes(asset.data.bytes) || translate("assets.unknownSize")} · {asset.data.mimeType}</p> : null}
                <div className="flex flex-wrap gap-2"><Tag>{asset.kind === "image" ? translate("assets.image") : asset.kind === "video" ? translate("assets.video") : translate("assets.text")}</Tag>{asset.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div>
                {asset.note ? <p className="studio-subtitle text-sm">{translate("assets.notes_732267")}{asset.note}</p> : null}
                <div>{asset.kind === "text" ? <Button type="primary" icon={<Copy className="size-4" />} onClick={onCopy}>{translate("assets.copyText")}</Button> : <Button type="primary" icon={<Download className="size-4" />} onClick={onDownload}>{translate("assets.download")}{asset.kind === "video" ? translate("assets.video") : translate("assets.image")}</Button>}</div>
            </div>
        </Modal>
    );
}
