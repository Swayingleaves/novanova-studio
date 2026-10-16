"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


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

const createKindOptions = (translator: typeof translate = translate): Array<{ label: string; value: AssetKind | "all" }> => ([
    { get label() { return translator("assets.all"); }, value: "all" },
    { get label() { return translator("assets.text"); }, value: "text" },
    { get label() { return translator("assets.image"); }, value: "image" },
    { get label() { return translator("assets.video"); }, value: "video" },
]);

export default function AssetsPage() {
    const translate = useTranslation();
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
    const filteredAssets = useMemo(() => queryAssets(assets, { keyword, kind }), [assets, keyword, kind, translate.locale]);
    const result = useMemo(() => paginateAssets(filteredAssets, page, pageSize), [filteredAssets, page, pageSize, translate.locale]);

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
        if (asset.kind === "text") copyText(asset.data.content, translate("assets.textCopied"));
    };
    const exportAll = async () => {
        if (!assets.length) return void message.warning(translate("assets.noAssetsToExport"));
        await exportAssets(assets);
    };
    const importPackage = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => addAsset(createImportedAsset(asset)));
            message.success(translate("assets.importedAssets", { value0: importedAssets.length }));
        } catch {
            message.error(translate("assets.invalidAssetArchiveChooseAnotherFile"));
        } finally {
            if (importInputRef.current) importInputRef.current.value = "";
        }
    };
    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        setDeletingAsset(null);
        message.success(translate("assets.assetDeleted"));
    };

    return (
        <main className="studio-page h-full overflow-y-auto px-4 py-6 sm:px-6">
            <div className="mx-auto flex max-w-7xl flex-col gap-5">
                <header className="flex flex-col gap-4 border-b border-[var(--studio-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
                    <div><p className="studio-caption text-xs">{translate("assets.contentResources")}</p><h1 className="studio-title mt-2 text-2xl font-semibold">{translate("assets.myAssets")}</h1><p className="studio-subtitle mt-2 text-sm">{translate("assets.manageTextImagesAndVideosCentrallyForReuseIn")}</p></div>
                    <div className="flex flex-wrap gap-2"><Button icon={<Download className="size-4" />} onClick={() => void exportAll()}>{translate("assets.export")}</Button><Button icon={<Upload className="size-4" />} onClick={() => importInputRef.current?.click()}>{translate("assets.import")}</Button><Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>{translate("assets.addAsset")}</Button></div>
                </header>

                <section className="studio-glass flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-center sm:justify-between" aria-label={translate("assets.filterAssets")}>
                    <Input allowClear prefix={<Search className="size-4 text-[var(--studio-faint)]" />} value={keyword} placeholder={translate("assets.searchTitleContentTagsOrSource")} className="sm:max-w-lg" onChange={(event) => changeQuery({ keyword: event.target.value })} />
                    <Segmented options={createKindOptions(translate)} value={kind} onChange={(value) => changeQuery({ kind: value as AssetKind | "all" })} />
                </section>

                {result.items.length ? <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{result.items.map((asset) => <AssetLibraryCard key={asset.id} asset={asset} onPreview={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={() => copyAsset(asset)} onDownload={() => downloadAsset(asset)} onDelete={() => setDeletingAsset(asset)} />)}</section> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("assets.noAssetsFound")} className="py-20" />}

                {result.total ? <Pagination className="self-center" current={result.page} pageSize={result.pageSize} total={result.total} showSizeChanger pageSizeOptions={[12, 24, 48]} onChange={(nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); }} /> : null}
            </div>

            <AssetEditorDialog open={editorOpen} asset={editingAsset} onClose={() => setEditorOpen(false)} />
            <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={() => previewAsset && copyAsset(previewAsset)} onDownload={() => previewAsset && downloadAsset(previewAsset)} />
            <input ref={importInputRef} hidden type="file" accept="application/zip,.zip" onChange={(event) => void importPackage(event.target.files?.[0])} />
            <Modal title={translate("assets.deleteAsset")} open={Boolean(deletingAsset)} okText={translate("assets.confirmDeletion")} cancelText={translate("assets.cancel")} okButtonProps={{ danger: true }} onOk={confirmDelete} onCancel={() => setDeletingAsset(null)}><p>「{deletingAsset?.title}{translate("assets.willBeRemovedFromTheLibraryThisCannotBe")}</p></Modal>
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
