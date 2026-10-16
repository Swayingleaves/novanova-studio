"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


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
const createKindOptions = (translator: typeof translate = translate): Array<{ label: string; value: AssetKind | "all" }> => ([
    { get label() { return translator("assets.all"); }, value: "all" },
    { get label() { return translator("assets.text"); }, value: "text" },
    { get label() { return translator("assets.image"); }, value: "image" },
    { get label() { return translator("assets.video"); }, value: "video" },
]);

export function AssetPickerModal({ open, onInsert, onClose, defaultTab }: AssetPickerModalProps) {
    const translate = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [kind, setKind] = useState<AssetKind | "all">(readInitialKind(defaultTab));
    const [page, setPage] = useState(1);
    const filteredAssets = useMemo(() => queryAssets(assets, { keyword, kind }), [assets, keyword, kind, translate.locale]);
    const result = useMemo(() => paginateAssets(filteredAssets, page, PAGE_SIZE), [filteredAssets, page, translate.locale]);
    const changeQuery = (next: { keyword?: string; kind?: AssetKind | "all" }) => {
        if (next.keyword !== undefined) setKeyword(next.keyword);
        if (next.kind !== undefined) setKind(next.kind);
        setPage(1);
    };

    return (
        <Modal title={translate("assets.insertMyAssets")} open={open} onCancel={onClose} footer={null} width={900} centered destroyOnHidden>
            <div className="grid gap-4" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Input allowClear prefix={<Search className="size-4 text-[var(--studio-faint)]" />} value={keyword} placeholder={translate("assets.searchTitleTagsOrContent")} className="sm:max-w-sm" onChange={(event) => changeQuery({ keyword: event.target.value })} />
                    <Segmented options={createKindOptions(translate)} value={kind} onChange={(value) => changeQuery({ kind: value as AssetKind | "all" })} />
                </div>

                {result.items.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {result.items.map((asset) => <AssetChoiceCard key={asset.id} asset={asset} onChoose={() => onInsert(createInsertPayload(asset))} />)}
                    </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("assets.noMatchingAssets")} className="py-14" />}

                {result.totalPages > 1 ? <Pagination className="justify-self-center" size="small" current={result.page} pageSize={result.pageSize} total={result.total} showSizeChanger={false} onChange={setPage} /> : null}
            </div>
        </Modal>
    );
}

function AssetChoiceCard({ asset, onChoose }: { asset: Asset; onChoose: () => void }) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    return (
        <button type="button" className="studio-panel-solid overflow-hidden text-left transition hover:-translate-y-0.5 hover:border-[var(--studio-primary-line)]" onClick={onChoose}>
            {cover ? (
                <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="studio-empty relative aspect-[4/3] overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs">
                        <span className="line-clamp-5 w-full break-words">{asset.kind === "text" ? asset.data.content : asset.title}</span>
                    </div>
                </div>
            )}
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
    return kind === "image" ? translate("assets.image") : kind === "video" ? translate("assets.video") : translate("assets.text");
}
