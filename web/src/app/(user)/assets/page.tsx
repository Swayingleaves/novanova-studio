"use client";

import { useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Modal, Pagination, Segmented } from "antd";
import { Download, Plus, Search, Upload } from "lucide-react";

import { AssetEditorDialog } from "@/features/assets/components/asset-editor-dialog";
import { AssetLibraryCard } from "@/features/assets/components/asset-library-card";
import { AssetPreviewDialog } from "@/features/assets/components/asset-preview-dialog";
import { downloadAsset } from "@/features/assets/lib/asset-download";
import { paginateAssets, queryAssets } from "@/features/assets/lib/asset-query";
import { exportAssets, readAssetPackage } from "@/features/assets/lib/asset-transfer";
import { useAssetStore, type Asset, type AssetKind } from "@/features/assets/stores/use-asset-store";
import { useCopyText } from "@/shared/hooks/use-copy-text";

const KIND_OPTIONS: Array<{ label: string; value: AssetKind | "all" }> = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
];

export default function AssetsPage() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const importInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kind, setKind] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(12);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const filteredAssets = useMemo(() => queryAssets(assets, { keyword, kind }), [assets, keyword, kind]);
    const result = useMemo(() => paginateAssets(filteredAssets, page, pageSize), [filteredAssets, page, pageSize]);

    const changeQuery = (next: { keyword?: string; kind?: AssetKind | "all" }) => {
        if (next.keyword !== undefined) setKeyword(next.keyword);
        if (next.kind !== undefined) setKind(next.kind);
        setPage(1);
    };
    const openCreate = () => {
        setEditingAsset(null);
        setEditorOpen(true);
    };
    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setEditorOpen(true);
    };
    const copyAsset = (asset: Asset) => {
        if (asset.kind === "text") copyText(asset.data.content, "文本已复制");
    };
    const exportAll = async () => {
        if (!assets.length) return void message.warning("暂无资产可导出");
        await exportAssets(assets);
    };
    const importPackage = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => addAsset(createImportedAsset(asset)));
            message.success(`已导入 ${importedAssets.length} 个资产`);
        } catch {
            message.error("导入失败，请选择有效的资产压缩包");
        } finally {
            if (importInputRef.current) importInputRef.current.value = "";
        }
    };
    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        setDeletingAsset(null);
        message.success("资产已删除");
    };

    return (
        <main className="studio-page h-full overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto flex max-w-7xl flex-col gap-5">
                <header className="flex flex-col gap-4 border-b border-[var(--studio-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
                    <div><p className="studio-caption text-xs">内容资源</p><h1 className="studio-title mt-2 text-2xl font-semibold">我的资产</h1><p className="studio-subtitle mt-2 text-sm">集中管理文本、图片和视频，在生成与画布中重复使用。</p></div>
                    <div className="flex flex-wrap gap-2"><Button icon={<Download className="size-4" />} onClick={() => void exportAll()}>导出</Button><Button icon={<Upload className="size-4" />} onClick={() => importInputRef.current?.click()}>导入</Button><Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>新增资产</Button></div>
                </header>

                <section className="studio-glass flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-center sm:justify-between" aria-label="资产筛选">
                    <Input allowClear prefix={<Search className="size-4 text-[var(--studio-faint)]" />} value={keyword} placeholder="搜索标题、内容、标签或来源" className="sm:max-w-lg" onChange={(event) => changeQuery({ keyword: event.target.value })} />
                    <Segmented options={KIND_OPTIONS} value={kind} onChange={(value) => changeQuery({ kind: value as AssetKind | "all" })} />
                </section>

                {result.items.length ? <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{result.items.map((asset) => <AssetLibraryCard key={asset.id} asset={asset} onPreview={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={() => copyAsset(asset)} onDownload={() => downloadAsset(asset)} onDelete={() => setDeletingAsset(asset)} />)}</section> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到资产" className="py-20" />}

                {result.total ? <Pagination className="self-center" current={result.page} pageSize={result.pageSize} total={result.total} showSizeChanger pageSizeOptions={[12, 24, 48]} onChange={(nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); }} /> : null}
            </div>

            <AssetEditorDialog open={editorOpen} asset={editingAsset} onClose={() => setEditorOpen(false)} />
            <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={() => previewAsset && copyAsset(previewAsset)} onDownload={() => previewAsset && downloadAsset(previewAsset)} />
            <input ref={importInputRef} hidden type="file" accept="application/zip,.zip" onChange={(event) => void importPackage(event.target.files?.[0])} />
            <Modal title="删除资产？" open={Boolean(deletingAsset)} okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }} onOk={confirmDelete} onCancel={() => setDeletingAsset(null)}><p>「{deletingAsset?.title}」将从资产库中移除，此操作无法撤销。</p></Modal>
        </main>
    );
}

function createImportedAsset(asset: Asset): Parameters<ReturnType<typeof useAssetStore.getState>["addAsset"]>[0] {
    const payload = { ...asset } as Record<string, unknown>;
    delete payload.id;
    delete payload.createdAt;
    delete payload.updatedAt;
    return payload as Parameters<ReturnType<typeof useAssetStore.getState>["addAsset"]>[0];
}
