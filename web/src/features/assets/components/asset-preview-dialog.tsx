"use client";

import { Button, Modal, Tag } from "antd";
import { Copy, Download } from "lucide-react";

import { formatBytes } from "@/features/generation/lib/image-utils";
import type { Asset } from "../stores/use-asset-store";

export function AssetPreviewDialog({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: () => void; onDownload: () => void }) {
    if (!asset) return null;
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    return (
        <Modal title={asset.title} open centered footer={null} width={820} onCancel={onClose} destroyOnHidden>
            <div className="grid gap-5 pt-1">
                {cover ? <img src={cover} alt={asset.title} className="max-h-[52vh] w-full rounded-lg object-contain" /> : null}
                {asset.kind === "video" ? <video src={asset.data.url} controls className="aspect-video w-full rounded-lg bg-black" /> : null}
                {asset.kind === "text" ? <div className="studio-panel-solid whitespace-pre-wrap p-4 text-sm leading-6">{asset.data.content}</div> : null}
                {asset.kind === "image" ? <p className="studio-subtitle text-sm">{asset.data.width} × {asset.data.height} · {formatBytes(asset.data.bytes) || "大小未知"} · {asset.data.mimeType}</p> : null}
                <div className="flex flex-wrap gap-2"><Tag>{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "文本"}</Tag>{asset.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div>
                {asset.note ? <p className="studio-subtitle text-sm">备注：{asset.note}</p> : null}
                <div>{asset.kind === "text" ? <Button type="primary" icon={<Copy className="size-4" />} onClick={onCopy}>复制文本</Button> : <Button type="primary" icon={<Download className="size-4" />} onClick={onDownload}>下载{asset.kind === "video" ? "视频" : "图片"}</Button>}</div>
            </div>
        </Modal>
    );
}
