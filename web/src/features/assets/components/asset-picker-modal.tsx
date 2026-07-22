"use client";

import { useMemo, useState } from "react";
import { Empty, Input, Modal, Pagination, Segmented, Tag } from "antd";
import { Search } from "lucide-react";

import { paginateAssets, queryAssets } from "@/features/assets/lib/asset-query";
import { useAssetStore, type Asset, type AssetKind } from "@/features/assets/stores/use-asset-store";
import type { ObjectStorageFile } from "@/shared/types/object-storage";

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string }
    | { kind: "image"; dataUrl: string; title: string; storageKey?: string; mimeType: string; objectStorage?: ObjectStorageFile }
    | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number; objectStorage?: ObjectStorageFile };

type AssetPickerModalProps = {
    open: boolean;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
    defaultTab?: string;
};

const PAGE_SIZE = 8;
const KIND_OPTIONS: Array<{ label: string; value: AssetKind | "all" }> = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
];

export function AssetPickerModal({ open, onInsert, onClose, defaultTab }: AssetPickerModalProps) {
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [kind, setKind] = useState<AssetKind | "all">(readInitialKind(defaultTab));
    const [page, setPage] = useState(1);
    const filteredAssets = useMemo(() => queryAssets(assets, { keyword, kind }), [assets, keyword, kind]);
    const result = useMemo(() => paginateAssets(filteredAssets, page, PAGE_SIZE), [filteredAssets, page]);
    const changeQuery = (next: { keyword?: string; kind?: AssetKind | "all" }) => {
        if (next.keyword !== undefined) setKeyword(next.keyword);
        if (next.kind !== undefined) setKind(next.kind);
        setPage(1);
    };

    return (
        <Modal title="插入我的资产" open={open} onCancel={onClose} footer={null} width={900} centered destroyOnHidden>
            <div className="grid gap-4" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Input allowClear prefix={<Search className="size-4 text-[var(--studio-faint)]" />} value={keyword} placeholder="搜索标题、标签或内容" className="sm:max-w-sm" onChange={(event) => changeQuery({ keyword: event.target.value })} />
                    <Segmented options={KIND_OPTIONS} value={kind} onChange={(value) => changeQuery({ kind: value as AssetKind | "all" })} />
                </div>

                {result.items.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {result.items.map((asset) => <AssetChoiceCard key={asset.id} asset={asset} onChoose={() => onInsert(createInsertPayload(asset))} />)}
                    </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的资产" className="py-14" />}

                {result.totalPages > 1 ? <Pagination className="justify-self-center" size="small" current={result.page} pageSize={result.pageSize} total={result.total} showSizeChanger={false} onChange={setPage} /> : null}
            </div>
        </Modal>
    );
}

function AssetChoiceCard({ asset, onChoose }: { asset: Asset; onChoose: () => void }) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    return (
        <button type="button" className="studio-panel-solid overflow-hidden text-left transition hover:-translate-y-0.5 hover:border-[var(--studio-primary-line)]" onClick={onChoose}>
            {cover ? <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" /> : <div className="studio-empty flex aspect-[4/3] items-center justify-center p-4 text-center text-xs">{asset.kind === "text" ? asset.data.content : asset.title}</div>}
            <div className="flex items-center justify-between gap-2 p-3"><span className="truncate text-sm font-medium">{asset.title}</span><Tag className="m-0 shrink-0">{assetKindLabel(asset.kind)}</Tag></div>
        </button>
    );
}

function createInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "image") return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, mimeType: asset.data.mimeType, title: asset.title, objectStorage: asset.data.objectStorage };
    return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, objectStorage: asset.data.objectStorage };
}

function readInitialKind(value?: string): AssetKind | "all" {
    return value === "text" || value === "image" || value === "video" ? value : "all";
}

function assetKindLabel(kind: AssetKind): string {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : "文本";
}
