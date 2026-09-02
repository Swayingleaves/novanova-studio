"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { App, Button, Checkbox, Empty, Input, InputNumber, Modal, Progress, Select, Table, Tabs, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Eye, FolderOpen, ImagePlus, Link2, Maximize2, Plus, RefreshCw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";

import { useAssetStore, type ImageAsset } from "@/features/assets/stores/use-asset-store";
import { ImageSettingsPanel } from "@/features/generation/components/image-settings-panel";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useConfigStore, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { uploadImage } from "@/features/storage/services/image-storage";
import { useCanvasTheme } from "./canvas-theme-provider";
import type { CanvasStoryboardAsset, CanvasStoryboardAssetGenerationItemStatus, CanvasStoryboardAssetGenerationSettings, CanvasStoryboardAssetKind, CanvasStoryboardNode, CanvasStoryboardShot } from "../types";
import { readStoryboardAssetImageCost, readStoryboardModelCost, removeStoryboardAssetAndAssociations, STORYBOARD_ASSET_KIND_LABELS, STORYBOARD_SHOT_SIZES } from "../domain/storyboard";

type StoryboardWorkspaceProps = {
    open: boolean;
    node: CanvasStoryboardNode | null;
    composing: boolean;
    composingShotId: string | null;
    onClose: () => void;
    onChangeStoryboard: (nodeId: string, updater: (storyboard: CanvasStoryboardNode["storyboard"]) => CanvasStoryboardNode["storyboard"]) => void;
    onComposePrompts: (nodeId: string, shotIds: string[], model: string) => void;
    onComposeShotPrompt: (nodeId: string, shotId: string) => void;
    onGenerateAssets: (nodeId: string, assetIds: string[], settings: CanvasStoryboardAssetGenerationSettings) => void;
    onMissingImageModelConfig?: () => void;
    onMissingTextModelConfig?: () => void;
};

const ASSET_KINDS: CanvasStoryboardAssetKind[] = ["character", "scene", "prop"];
const SHOT_TABLE_SCROLL_WIDTH = 2120;

/** 分镜脚本全屏工作区，集中编辑镜头、资产和最终提示词。 */
export function StoryboardWorkspace({ open, node, composing, composingShotId, onClose, onChangeStoryboard, onComposePrompts, onComposeShotPrompt, onGenerateAssets, onMissingImageModelConfig, onMissingTextModelConfig }: StoryboardWorkspaceProps) {
    const { message, modal } = App.useApp();
    const theme = useCanvasTheme();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const creditBalance = useUserStore((state) => state.user?.creditBalance);
    const [assetModalOpen, setAssetModalOpen] = useState(false);
    const [activeAssetKind, setActiveAssetKind] = useState<CanvasStoryboardAssetKind>("character");
    const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
    const [imagePickerAssetId, setImagePickerAssetId] = useState<string | null>(null);
    const [assetGenerationOpen, setAssetGenerationOpen] = useState(false);
    const [promptGenerationOpen, setPromptGenerationOpen] = useState(false);
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [selectedPromptShotIds, setSelectedPromptShotIds] = useState<string[]>([]);
    const [assetImageSettings, setAssetImageSettings] = useState<CanvasStoryboardAssetGenerationSettings>(() => createDefaultAssetImageSettings(effectiveConfig));
    const [promptModel, setPromptModel] = useState("");
    const [imageKeyword, setImageKeyword] = useState("");
    const [uploadingAssetId, setUploadingAssetId] = useState<string | null>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetAssetIdRef = useRef<string | null>(null);
    const pendingAssetSelectionRef = useRef<string[] | null>(null);
    const effectiveConfigRef = useRef(effectiveConfig);
    effectiveConfigRef.current = effectiveConfig;
    const editingLocked = composing || node?.execution.phase === "running";
    const assets = useAssetStore((state) => state.assets);
    const imageAssets = useMemo(
        () => assets.filter((asset): asset is ImageAsset => asset.kind === "image" && Boolean(readImageAssetSource(asset))).filter((asset) => `${asset.title} ${asset.tags.join(" ")}`.toLowerCase().includes(imageKeyword.trim().toLowerCase())),
        [assets, imageKeyword],
    );

    useEffect(() => {
        if (!open) {
            pendingAssetSelectionRef.current = null;
            setAssetGenerationOpen(false);
            setPromptGenerationOpen(false);
            setAssetModalOpen(false);
            setActiveAssetKind("character");
            setPreviewAssetId(null);
        }
    }, [node?.id, open]);

    useEffect(() => {
        if (!assetGenerationOpen || !node) return;
        const requestedAssetIds = pendingAssetSelectionRef.current;
        pendingAssetSelectionRef.current = null;
        const availableAssetIds = node.storyboard.assets.map((asset) => asset.id);
        const requestedSelection = requestedAssetIds?.filter((assetId) => availableAssetIds.includes(assetId));
        setSelectedAssetIds(requestedSelection?.length ? requestedSelection : availableAssetIds);
        setAssetImageSettings(node.storyboard.assetGeneration?.settings || createDefaultAssetImageSettings(effectiveConfigRef.current));
    }, [assetGenerationOpen, node?.id]);

    useEffect(() => {
        if (!promptGenerationOpen || !node) return;
        setSelectedPromptShotIds(node.storyboard.shots.map((shot) => shot.id));
        setPromptModel(node.content.model || effectiveConfigRef.current.textModel);
    }, [node?.id, promptGenerationOpen]);

    useEffect(() => {
        if (editingLocked) setImagePickerAssetId(null);
    }, [editingLocked]);

    const updateShots = (updater: (shots: CanvasStoryboardShot[]) => CanvasStoryboardShot[]) => {
        if (!node || editingLocked) return;
        onChangeStoryboard(node.id, (storyboard) => ({ ...storyboard, shots: updater(storyboard.shots) }));
    };

    const updateAssets = (updater: (currentAssets: CanvasStoryboardAsset[]) => CanvasStoryboardAsset[]) => {
        if (!node || editingLocked) return;
        onChangeStoryboard(node.id, (storyboard) => ({ ...storyboard, assets: updater(storyboard.assets) }));
    };

    const updateShot = (shotId: string, patch: Partial<CanvasStoryboardShot>) => {
        updateShots((shots) => shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)));
    };

    const addShot = () => {
        const nextShotNumber = Math.max(0, ...(node?.storyboard.shots.map((shot) => shot.shotNumber) || [])) + 1;
        updateShots((shots) => [...shots, createStoryboardShot(nextShotNumber)]);
    };

    const deleteShot = (shotId: string) => updateShots((shots) => shots.filter((shot) => shot.id !== shotId));

    const confirmDeleteShot = (shotId: string) => {
        if (!node || editingLocked) return;
        const shot = node.storyboard.shots.find((item) => item.id === shotId);
        modal.confirm({
            title: "删除镜头",
            content: shot ? `确定删除镜号 ${shot.shotNumber} 的镜头吗？删除后无法恢复。` : "确定删除这个镜头吗？删除后无法恢复。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => deleteShot(shotId),
        });
    };

    const updateAsset = (assetId: string, patch: Partial<CanvasStoryboardAsset>) => {
        updateAssets((currentAssets) => currentAssets.map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)));
    };

    const addAsset = (kind: CanvasStoryboardAssetKind) => {
        updateAssets((currentAssets) => [...currentAssets, createStoryboardAsset(kind)]);
    };

    const confirmDeleteAsset = (assetId: string) => {
        if (!node || editingLocked) return;
        const asset = node.storyboard.assets.find((item) => item.id === assetId);
        modal.confirm({
            title: "删除资产",
            content: asset?.name ? `确定删除资产“${asset.name}”吗？删除后无法恢复。` : "确定删除这个资产吗？删除后无法恢复。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => onChangeStoryboard(node.id, (storyboard) => removeStoryboardAssetAndAssociations(storyboard, assetId)),
        });
    };

    const confirmRemoveAssetImage = (assetId: string) => {
        if (!node || editingLocked) return;
        const asset = node.storyboard.assets.find((item) => item.id === assetId);
        modal.confirm({
            title: "移除图片关联",
            content: asset?.name ? `确定移除资产“${asset.name}”的图片关联吗？` : "确定移除这个资产的图片关联吗？",
            okText: "移除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => updateAsset(assetId, { image: undefined }),
        });
    };

    const requestImageUpload = (assetId: string) => {
        uploadTargetAssetIdRef.current = assetId;
        uploadInputRef.current?.click();
    };

    const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        const assetId = uploadTargetAssetIdRef.current;
        const file = event.target.files?.[0];
        event.target.value = "";
        uploadTargetAssetIdRef.current = null;
        if (!assetId || !file) return;
        setUploadingAssetId(assetId);
        try {
            const image = await uploadImage(file);
            updateAsset(assetId, {
                image: {
                    source: image.url,
                    storageKey: image.storageKey,
                    mimeType: image.mimeType,
                    objectStorage: image.objectStorage,
                },
            });
            message.success("资产图片已关联");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "资产图片上传失败");
        } finally {
            setUploadingAssetId(null);
        }
    };

    const selectAssetImage = (asset: ImageAsset) => {
        if (!imagePickerAssetId || editingLocked) return;
        updateAsset(imagePickerAssetId, {
            image: {
                source: readImageAssetSource(asset),
                storageKey: asset.data.storageKey,
                mimeType: asset.data.mimeType,
                objectStorage: asset.data.objectStorage,
            },
        });
        setImagePickerAssetId(null);
        message.success("已关联资产库图片");
    };

    const shots = node?.storyboard.shots || [];
    const storyboardAssets = node?.storyboard.assets || [];
    const previewAsset = storyboardAssets.find((asset) => asset.id === previewAssetId) || null;
    const columns = useMemo<ColumnsType<CanvasStoryboardShot>>(
        () => buildShotColumns({
            editable: !editingLocked,
            assets: storyboardAssets,
            composingShotId,
            onUpdate: updateShot,
            onDelete: confirmDeleteShot,
            onComposePrompt: (shotId) => node && onComposeShotPrompt(node.id, shotId),
        }),
        [composingShotId, editingLocked, node?.id, storyboardAssets],
    );
    const assetGeneration = node?.storyboard.assetGeneration;
    const assetGenerating = assetGeneration?.phase === "running";
    const selectedAssets = storyboardAssets.filter((asset) => selectedAssetIds.includes(asset.id));
    const assetUnitCost = readStoryboardAssetImageCost(effectiveConfig.modelCosts, assetImageSettings.model, 1);
    const assetTotalCredits = readStoryboardAssetImageCost(effectiveConfig.modelCosts, assetImageSettings.model, selectedAssets.length);
    const selectedAssetNameError = selectedAssets.find((asset) => !asset.name.trim());
    const assetModelCostConfigured = effectiveConfig.modelCosts.some((item) => item.taskType === "image" && item.model === assetImageSettings.model);
    const assetModelReady = Boolean(assetImageSettings.model && effectiveConfig.imageModels.includes(assetImageSettings.model) && assetModelCostConfigured && isAiConfigReady(effectiveConfig, assetImageSettings.model));
    const assetBalanceInsufficient = typeof creditBalance === "number" && assetTotalCredits > creditBalance;
    const allAssetsSelected = Boolean(storyboardAssets.length) && selectedAssetIds.length === storyboardAssets.length;
    const someAssetsSelected = selectedAssetIds.length > 0 && !allAssetsSelected;
    const selectedPromptShots = shots.filter((shot) => selectedPromptShotIds.includes(shot.id));
    const promptModelCost = readStoryboardModelCost(effectiveConfig.modelCosts, promptModel);
    const promptTotalCredits = Math.max(0, promptModelCost) * selectedPromptShots.length;
    const promptModelCostConfigured = effectiveConfig.modelCosts.some((item) => item.taskType === "text" && item.model === promptModel);
    const promptModelReady = Boolean(promptModel && effectiveConfig.textModels.includes(promptModel) && promptModelCostConfigured && isAiConfigReady(effectiveConfig, promptModel));
    const promptBalanceInsufficient = typeof creditBalance === "number" && promptTotalCredits > creditBalance;
    const allPromptShotsSelected = Boolean(shots.length) && selectedPromptShotIds.length === shots.length;
    const somePromptShotsSelected = selectedPromptShotIds.length > 0 && !allPromptShotsSelected;
    const generatedAssetCount = storyboardAssets.filter((asset) => Boolean(asset.image?.source?.trim())).length;
    const openPromptGeneration = () => {
        if (!node || editingLocked || !shots.length) return;
        setSelectedPromptShotIds(shots.map((shot) => shot.id));
        setPromptModel(node.content.model || effectiveConfig.textModel);
        setPromptGenerationOpen(true);
    };
    const toggleAllPromptShots = () => setSelectedPromptShotIds(allPromptShotsSelected ? [] : shots.map((shot) => shot.id));
    const confirmComposePrompts = () => {
        if (!node || editingLocked) return;
        if (!selectedPromptShots.length) {
            message.warning("请至少选择一个镜头");
            return;
        }
        if (!promptModelReady) {
            onMissingTextModelConfig?.();
            message.error("请选择可用的文本模型后再生成最终提示词");
            return;
        }
        if (promptBalanceInsufficient) {
            message.error(`积分不足，合成 ${selectedPromptShots.length} 个镜头需要 ${promptTotalCredits} 积分，当前可用 ${creditBalance} 积分`);
            return;
        }
        modal.confirm({
            title: "生成最终提示词",
            content: `将为已选择的 ${selectedPromptShots.length} 个镜头生成最终提示词，预计消耗 ${promptTotalCredits} 积分。对应的现有提示词会被覆盖，是否继续？`,
            okText: "确认生成",
            cancelText: "取消",
            onOk: () => {
                setPromptGenerationOpen(false);
                onComposePrompts(node.id, selectedPromptShots.map((shot) => shot.id), promptModel);
            },
        });
    };
    const assetAssociationCounts = useMemo(
        () => Object.fromEntries(storyboardAssets.map((asset) => [asset.id, shots.filter((shot) => shot.assetIds.includes(asset.id)).length])),
        [shots, storyboardAssets],
    );
    const toggleAllAssets = () => setSelectedAssetIds(allAssetsSelected ? [] : storyboardAssets.map((asset) => asset.id));
    const openAssetGeneration = (assetIds?: string[]) => {
        pendingAssetSelectionRef.current = assetIds?.length ? assetIds : null;
        setAssetGenerationOpen(true);
    };
    const updateAssetImageSettings = (key: "quality" | "imageResolution" | "size", value: string) => {
        setAssetImageSettings((current) => ({ ...current, [key]: value }));
    };
    const startAssetGeneration = () => {
        if (!node || editingLocked || assetGenerating) return;
        if (!selectedAssets.length) {
            message.warning("请至少勾选一项资产");
            return;
        }
        if (selectedAssetNameError) {
            message.error("请填写已勾选资产的名称后再生成图片");
            return;
        }
        if (!assetModelReady) {
            onMissingImageModelConfig?.();
            message.error("请选择可用的图片模型后再生成资产图片");
            return;
        }
        if (assetBalanceInsufficient) {
            message.error(`积分不足，生成 ${selectedAssets.length} 项资产需要 ${assetTotalCredits} 积分，当前可用 ${creditBalance} 积分`);
            return;
        }
        onGenerateAssets(
            node.id,
            selectedAssets.map((asset) => asset.id),
            assetImageSettings,
        );
    };
    const assetPanelConfig = useMemo(
        () => ({ ...effectiveConfig, model: assetImageSettings.model, imageModel: assetImageSettings.model, quality: assetImageSettings.quality, imageResolution: assetImageSettings.imageResolution, size: assetImageSettings.size, count: "1" }),
        [assetImageSettings, effectiveConfig],
    );
    const assetGenerationCompletedCount =
        assetGeneration?.selectedAssetIds.filter((assetId) => {
            const status = assetGeneration.statuses[assetId];
            return status === "succeeded" || status === "failed";
        }).length || 0;
    const openAssetModal = () => {
        setActiveAssetKind("character");
        setAssetModalOpen(true);
    };
    const closeAssetModal = () => {
        setAssetModalOpen(false);
        setActiveAssetKind("character");
        setPreviewAssetId(null);
    };

    return (
        <>
            <Modal
                title="分镜头脚本"
                open={open && Boolean(node)}
                onCancel={onClose}
                footer={null}
                width="calc(100vw - 32px)"
                style={{ top: 16 }}
                styles={{ body: { height: "calc(100dvh - 104px)", padding: 0, overflow: "hidden" } }}
                destroyOnHidden={false}
            >
                <div className="flex h-full min-h-0 flex-col">
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-3" style={{ borderColor: "var(--studio-line)" }}>
                        <div className="flex min-w-0 items-baseline gap-3">
                            <span className="text-base font-semibold">镜头列表</span>
                            <span className="text-sm text-[var(--studio-muted)]">共 {shots.length} 个镜头</span>
                        </div>
                        <Button icon={<FolderOpen className="size-4" />} onClick={openAssetModal}>
                            资产（{storyboardAssets.length}）
                        </Button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-4">
                        <div className="flex min-h-full min-w-0 flex-col gap-4">
                            <div className="min-w-0">
                                <Table<CanvasStoryboardShot> rowKey="id" dataSource={shots} columns={columns} pagination={false} size="small" tableLayout="fixed" scroll={{ x: SHOT_TABLE_SCROLL_WIDTH }} locale={{ emptyText: "暂无镜头" }} />
                            </div>
                            <Button className="w-fit" icon={<Plus className="size-4" />} disabled={editingLocked} onClick={addShot}>
                                添加镜头
                            </Button>
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-6 py-3" style={{ borderColor: "var(--studio-line)" }}>
                        <Button icon={<ImagePlus className="size-4" />} disabled={editingLocked || !storyboardAssets.length} onClick={() => openAssetGeneration()}>
                            一键生成全部资产（{storyboardAssets.length} 项）
                        </Button>
                        <Button type="primary" icon={<Sparkles className="size-4" />} loading={composing} disabled={editingLocked || !shots.length} onClick={openPromptGeneration}>
                            一键生成最终提示词（{shots.length} 镜头）
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                title="选择要生成的最终提示词"
                open={promptGenerationOpen && open && Boolean(node)}
                onCancel={() => setPromptGenerationOpen(false)}
                width={960}
                destroyOnHidden={false}
                footer={[
                    <Button key="cancel" onClick={() => setPromptGenerationOpen(false)}>
                        取消
                    </Button>,
                    <Button
                        key="generate"
                        type="primary"
                        disabled={editingLocked || !selectedPromptShots.length || !promptModelReady || Boolean(promptBalanceInsufficient)}
                        onClick={confirmComposePrompts}
                    >
                        生成已选镜头（{selectedPromptShots.length} 个，{promptTotalCredits} 积分）
                    </Button>,
                ]}
            >
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <section className="min-w-0 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--studio-line)" }}>
                            <Checkbox checked={allPromptShotsSelected} indeterminate={somePromptShotsSelected} disabled={editingLocked} onChange={toggleAllPromptShots}>
                                全选当前镜头（{shots.length} 个）
                            </Checkbox>
                            <span className="text-xs text-[var(--studio-muted)]">已选择 {selectedPromptShots.length} 个</span>
                        </div>
                        <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                            {shots.map((shot) => (
                                <div key={shot.id} className="flex min-w-0 items-start gap-3 rounded-md border px-3 py-2.5" style={{ borderColor: "var(--studio-line)", background: "var(--studio-surface-raised)" }}>
                                    <Checkbox
                                        className="mt-0.5"
                                        aria-label={`选择镜号 ${shot.shotNumber}`}
                                        checked={selectedPromptShotIds.includes(shot.id)}
                                        disabled={editingLocked}
                                        onChange={(event) => setSelectedPromptShotIds((current) => (event.target.checked ? [...new Set([...current, shot.id])] : current.filter((id) => id !== shot.id)))}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                            <span className="font-semibold">镜号 {shot.shotNumber}</span>
                                            <span className="text-[var(--studio-muted)]">{shot.durationSeconds} 秒</span>
                                            <Tag className="m-0">{shot.shotSize}</Tag>
                                            {shot.finalPrompt ? <span className="text-amber-600">会覆盖现有提示词</span> : null}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-sm text-[var(--studio-muted)]">{shot.visualDescription || "未填写画面描述"}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                    <aside className="space-y-5 rounded-md border p-4" style={{ borderColor: "var(--studio-line)", background: "var(--studio-surface-raised)" }}>
                        <div>
                            <h3 className="text-sm font-semibold">合成设置</h3>
                            <p className="mt-1 text-xs text-[var(--studio-muted)]">每个镜头按所选文本模型单价计费</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[var(--studio-muted)]">文本模型</label>
                            <ModelPicker
                                config={effectiveConfig}
                                value={promptModel}
                                capability="text"
                                fullWidth
                                onChange={setPromptModel}
                                onMissingConfig={onMissingTextModelConfig}
                            />
                        </div>
                        <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: "var(--studio-line)" }}>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[var(--studio-muted)]">单镜头积分</span>
                                <span>{promptModelCost}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 font-semibold">
                                <span>预计消耗</span>
                                <span>{promptTotalCredits} 积分</span>
                            </div>
                        </div>
                        {!promptModelReady ? <p className="text-xs text-red-500">请选择可用的文本模型</p> : null}
                        {promptBalanceInsufficient ? <p className="text-xs text-red-500">积分不足，当前可用 {creditBalance ?? 0} 积分</p> : null}
                    </aside>
                </div>
            </Modal>

            <Modal
                title={null}
                open={assetModalOpen && open && Boolean(node)}
                onCancel={closeAssetModal}
                footer={null}
                width="min(calc(100vw - 32px), 1360px)"
                style={{ top: 16 }}
                styles={{ body: { height: "calc(100dvh - 112px)", maxHeight: "calc(100dvh - 112px)", padding: 0, overflow: "hidden" } }}
                destroyOnHidden={false}
            >
                <div className="flex h-full min-h-0 flex-col gap-6 px-4 py-4 sm:px-6 sm:py-5">
                    <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b pb-5" style={{ borderColor: "var(--studio-line)" }}>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-semibold">分镜资产</h2>
                                <Tag className="m-0">{storyboardAssets.length} 项</Tag>
                            </div>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">统一管理角色、场景和道具。点击图片可查看完整原图。</p>
                        </div>
                        <Button icon={<ImagePlus className="size-4" />} disabled={editingLocked || !storyboardAssets.length} onClick={() => openAssetGeneration()}>
                            批量生成图片
                        </Button>
                    </div>
                    <div className="grid shrink-0 gap-3 sm:grid-cols-3">
                        <StoryboardAssetSummary label="已生成图片" value={`${generatedAssetCount}/${storyboardAssets.length}`} hint="资产完成度" />
                        <StoryboardAssetSummary label="已关联镜头" value={String(Object.values(assetAssociationCounts).reduce((total, count) => total + count, 0))} hint="资产与镜头的关联数" />
                        <StoryboardAssetSummary label="待处理" value={String(Math.max(0, storyboardAssets.length - generatedAssetCount))} hint="还未生成图片" />
                    </div>
                    <Tabs
                        activeKey={activeAssetKind}
                        destroyOnHidden
                        className="flex min-h-0 flex-1 flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-tabpane]:min-h-0"
                        onChange={(key) => setActiveAssetKind(key as CanvasStoryboardAssetKind)}
                        items={ASSET_KINDS.map((kind) => {
                            const kindAssets = storyboardAssets.filter((asset) => asset.kind === kind);
                            return {
                                key: kind,
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        {STORYBOARD_ASSET_KIND_LABELS[kind]}
                                        <span className="text-xs opacity-60">{kindAssets.length}</span>
                                    </span>
                                ),
                                children: (
                                    <div className="thin-scrollbar h-full overflow-y-auto pr-1">
                                        <StoryboardAssetGroup
                                            kind={kind}
                                            assets={kindAssets}
                                            assetAssociationCounts={assetAssociationCounts}
                                            uploadingAssetId={uploadingAssetId}
                                            disabled={editingLocked}
                                            onAdd={() => addAsset(kind)}
                                            onUpdate={updateAsset}
                                            onRemove={confirmDeleteAsset}
                                            onRemoveImage={confirmRemoveAssetImage}
                                            onChooseImage={setImagePickerAssetId}
                                            onUploadImage={requestImageUpload}
                                            onRegenerate={(assetId) => openAssetGeneration([assetId])}
                                            onPreview={(assetId) => setPreviewAssetId(assetId)}
                                        />
                                    </div>
                                ),
                            };
                        })}
                    />
                </div>
            </Modal>

            <Modal
                title={previewAsset?.name || "资产图片"}
                open={Boolean(previewAsset?.image?.source)}
                onCancel={() => setPreviewAssetId(null)}
                footer={null}
                width="min(calc(100vw - 32px), 1440px)"
                centered
                styles={{ body: { padding: 0, overflow: "hidden" } }}
                destroyOnHidden
            >
                {previewAsset?.image?.source ? (
                    <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
                        <div className="flex min-h-[52dvh] items-center justify-center bg-[var(--studio-surface-raised)] p-3 sm:p-6 lg:min-h-[min(76dvh,800px)]">
                            <img
                                src={previewAsset.image.source}
                                alt={previewAsset.name || "资产图片"}
                                className="block max-h-[min(76dvh,800px)] max-w-full object-contain"
                                decoding="async"
                            />
                        </div>
                        <aside className="space-y-5 border-t p-5 lg:border-l lg:border-t-0" style={{ borderColor: "var(--studio-line)" }}>
                            <div>
                                <p className="text-xs font-medium text-[var(--studio-muted)]">资产类型</p>
                                <p className="mt-1 text-sm font-semibold">{STORYBOARD_ASSET_KIND_LABELS[previewAsset.kind]}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-[var(--studio-muted)]">关联镜头</p>
                                <p className="mt-1 flex items-center gap-2 text-sm font-semibold"><Link2 className="size-4" aria-hidden="true" />{assetAssociationCounts[previewAsset.id] || 0} 个镜头</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-[var(--studio-muted)]">资产描述</p>
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--studio-muted)]">{previewAsset.description || "暂无资产描述"}</p>
                            </div>
                            <Button block icon={<Maximize2 className="size-4" />} onClick={() => window.open(previewAsset.image?.source, "_blank", "noopener,noreferrer")}>在新窗口打开原图</Button>
                        </aside>
                    </div>
                ) : null}
            </Modal>

            <Modal
                title="批量生成资产图片"
                open={assetGenerationOpen && Boolean(node)}
                onCancel={() => {
                    pendingAssetSelectionRef.current = null;
                    setAssetGenerationOpen(false);
                }}
                width={1120}
                destroyOnHidden={false}
                footer={[
                    <Button
                        key="cancel"
                        onClick={() => {
                            pendingAssetSelectionRef.current = null;
                            setAssetGenerationOpen(false);
                        }}
                    >
                        关闭
                    </Button>,
                    <Button
                        key="generate"
                        type="primary"
                        loading={assetGenerating}
                        disabled={editingLocked || !selectedAssets.length || Boolean(selectedAssetNameError) || !assetModelReady || Boolean(assetBalanceInsufficient)}
                        onClick={startAssetGeneration}
                    >
                        生成选中资产（{selectedAssets.length} 项，{assetTotalCredits} 积分）
                    </Button>,
                ]}
            >
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <section className="min-w-0 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--studio-line)" }}>
                            <Checkbox checked={allAssetsSelected} indeterminate={someAssetsSelected} disabled={assetGenerating} onChange={toggleAllAssets}>
                                全选当前资产（{storyboardAssets.length} 项）
                            </Checkbox>
                            <span className="text-xs text-[var(--studio-muted)]">已勾选 {selectedAssets.length} 项</span>
                        </div>
                        <div className="max-h-[58vh] space-y-5 overflow-y-auto pr-1">
                            {ASSET_KINDS.map((kind) => {
                                const kindAssets = storyboardAssets.filter((asset) => asset.kind === kind);
                                if (!kindAssets.length) return null;
                                return (
                                    <div key={kind} className="space-y-2">
                                        <h3 className="text-sm font-semibold">{STORYBOARD_ASSET_KIND_LABELS[kind]}</h3>
                                        {kindAssets.map((asset) => {
                                            const status = assetGeneration?.statuses[asset.id];
                                            return (
                                                <StoryboardAssetGenerationRow
                                                    key={asset.id}
                                                    asset={asset}
                                                    checked={selectedAssetIds.includes(asset.id)}
                                                    status={status}
                                                    error={assetGeneration?.errors?.[asset.id]}
                                                    disabled={assetGenerating}
                                                    onChange={(checked) => setSelectedAssetIds((current) => (checked ? [...new Set([...current, asset.id])] : current.filter((id) => id !== asset.id)))}
                                                />
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                    <aside className="space-y-5 rounded-md border p-4" style={{ borderColor: "var(--studio-line)", background: "var(--studio-surface-raised)" }}>
                        <div>
                            <h3 className="text-sm font-semibold">图片设置</h3>
                            <p className="mt-1 text-xs text-[var(--studio-muted)]">每项资产固定生成 1 张图片</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[var(--studio-muted)]">模型</label>
                            <ModelPicker
                                config={effectiveConfig}
                                value={assetImageSettings.model}
                                capability="image"
                                fullWidth
                                onChange={(value) => setAssetImageSettings((current) => ({ ...current, model: value }))}
                                onMissingConfig={onMissingImageModelConfig}
                            />
                        </div>
                        <ImageSettingsPanel
                            config={assetPanelConfig}
                            theme={theme}
                            showTitle={false}
                            showCount={false}
                            className="space-y-4 px-0 py-0"
                            onConfigChange={(key, value) => (key !== "count" ? updateAssetImageSettings(key, value) : undefined)}
                        />
                        <div className="border-t pt-4 text-sm" style={{ borderColor: "var(--studio-line)" }}>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[var(--studio-muted)]">单项积分</span>
                                <strong>{assetUnitCost}</strong>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-[var(--studio-muted)]">预计消耗</span>
                                <strong>{assetTotalCredits} 积分</strong>
                            </div>
                            {typeof creditBalance === "number" ? (
                                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--studio-muted)]">
                                    <span>当前余额</span>
                                    <span>{creditBalance} 积分</span>
                                </div>
                            ) : null}
                        </div>
                        {assetGenerating ? (
                            <div className="space-y-2">
                                <Progress percent={assetGeneration?.progress || 0} size="small" />
                                <p className="text-xs text-[var(--studio-muted)]">
                                    已处理 {assetGenerationCompletedCount}/{assetGeneration?.selectedAssetIds.length || selectedAssets.length} 项
                                </p>
                            </div>
                        ) : null}
                        {!selectedAssets.length ? <p className="text-xs text-[var(--studio-danger)]">请至少勾选一项资产后再开始生成</p> : null}
                        {selectedAssetNameError ? <p className="text-xs text-[var(--studio-danger)]">请先填写“{selectedAssetNameError.name || "未命名资产"}”的名称</p> : null}
                        {!assetModelReady ? <p className="text-xs text-[var(--studio-danger)]">请选择已启用且已配置价格的图片模型</p> : null}
                        {assetBalanceInsufficient ? <p className="text-xs text-[var(--studio-danger)]">当前积分不足以生成已勾选资产</p> : null}
                    </aside>
                </div>
            </Modal>

            <input ref={uploadInputRef} type="file" accept="image/*" hidden onChange={(event) => void handleImageUpload(event)} />
            <Modal title="关联资产库图片" open={Boolean(imagePickerAssetId)} onCancel={() => setImagePickerAssetId(null)} footer={null} width={900} destroyOnHidden>
                <div className="space-y-4">
                    <Input allowClear value={imageKeyword} placeholder="搜索图片资产" onChange={(event) => setImageKeyword(event.target.value)} />
                    {imageAssets.length ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            {imageAssets.map((asset) => (
                                <button key={asset.id} type="button" className="overflow-hidden rounded-md border text-left transition hover:-translate-y-0.5" style={{ borderColor: "var(--studio-line)" }} onClick={() => selectAssetImage(asset)}>
                                    <img src={readImageAssetSource(asset)} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                                    <span className="block truncate px-3 py-2 text-sm">{asset.title}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可关联的图片资产" className="py-10" />
                    )}
                </div>
            </Modal>
        </>
    );
}

type StoryboardAssetGroupProps = {
    kind: CanvasStoryboardAssetKind;
    assets: CanvasStoryboardAsset[];
    assetAssociationCounts: Record<string, number>;
    uploadingAssetId: string | null;
    disabled: boolean;
    onAdd: () => void;
    onUpdate: (assetId: string, patch: Partial<CanvasStoryboardAsset>) => void;
    onRemove: (assetId: string) => void;
    onRemoveImage: (assetId: string) => void;
    onChooseImage: (assetId: string) => void;
    onUploadImage: (assetId: string) => void;
    onRegenerate: (assetId: string) => void;
    onPreview: (assetId: string) => void;
};

/** 资产面板顶部的摘要指标。 */
function StoryboardAssetSummary({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--studio-line)", background: "var(--studio-surface-raised)" }}>
            <p className="text-xs text-[var(--studio-muted)]">{label}</p>
            <div className="mt-1 flex items-end justify-between gap-2">
                <strong className="text-xl font-semibold tabular-nums">{value}</strong>
                <span className="text-[11px] text-[var(--studio-muted)]">{hint}</span>
            </div>
        </div>
    );
}

/** 单类资产的可编辑列表。 */
function StoryboardAssetGroup({ kind, assets, assetAssociationCounts, uploadingAssetId, disabled, onAdd, onUpdate, onRemove, onRemoveImage, onChooseImage, onUploadImage, onRegenerate, onPreview }: StoryboardAssetGroupProps) {
    const gridClassName = kind === "scene"
        ? "grid gap-4 md:grid-cols-2"
        : "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between gap-4 border-b pb-2" style={{ borderColor: "var(--studio-line)" }}>
                <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">{STORYBOARD_ASSET_KIND_LABELS[kind]}</h3>
                    <span className="rounded-full bg-[var(--studio-surface-raised)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">{assets.length}</span>
                </div>
                <Button size="small" icon={<Plus className="size-4" />} disabled={disabled} onClick={onAdd}>
                    新增{STORYBOARD_ASSET_KIND_LABELS[kind]}
                </Button>
            </div>
            {assets.length ? (
                <div className={gridClassName}>
                    {assets.map((asset) => (
                        <div
                            key={asset.id}
                            className="group min-w-0 overflow-hidden rounded-lg border bg-[var(--studio-surface)] transition-[border-color,transform] duration-200 hover:-translate-y-px hover:border-[var(--studio-line-strong)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                            style={{ borderColor: "var(--studio-line)" }}
                        >
                            <div className="relative overflow-hidden border-b" style={{ aspectRatio: storyboardAssetAspectRatio(kind), background: "var(--studio-surface-raised)", borderColor: "var(--studio-line)" }}>
                                {asset.image?.source ? (
                                    <button
                                        type="button"
                                        className="group/image relative block size-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-action)] focus-visible:ring-inset"
                                        aria-label={`查看${asset.name || "未命名资产"}完整图片`}
                                        onClick={() => onPreview(asset.id)}
                                    >
                                        <img src={asset.image.source} alt="" className="block size-full object-contain" loading="lazy" decoding="async" />
                                        <span className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-1.5 rounded-md bg-black/65 px-3 py-2 text-xs font-medium text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-visible/image:opacity-100 motion-reduce:transition-none">
                                            <Eye className="size-3.5" aria-hidden="true" />查看全图
                                        </span>
                                    </button>
                                ) : (
                                    <div className="grid size-full place-items-center text-xs text-[var(--studio-muted)]">未关联图片</div>
                                )}
                                {uploadingAssetId === asset.id ? <div className="absolute inset-0 grid place-items-center bg-black/45 text-xs text-white">上传中</div> : null}
                            </div>
                            <div className="min-w-0 space-y-2.5 p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-[var(--studio-muted)]">资产信息</span>
                                    <span className="shrink-0 text-[11px] text-[var(--studio-muted)]">关联 {assetAssociationCounts[asset.id] || 0} 镜头</span>
                                </div>
                                <Input className="!font-medium" value={asset.name} disabled={disabled} placeholder="资产名称" onChange={(event) => onUpdate(asset.id, { name: event.target.value })} />
                                <Input.TextArea value={asset.description} disabled={disabled} placeholder="资产描述" autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => onUpdate(asset.id, { description: event.target.value })} />
                                <div className="flex flex-wrap items-center justify-end gap-1 border-t pt-2" style={{ borderColor: "var(--studio-line)" }}>
                                    <Tooltip title="AI重新生成">
                                        <Button type="text" size="small" disabled={disabled} aria-label="AI重新生成" icon={<RefreshCw className="size-4" />} onClick={() => onRegenerate(asset.id)} />
                                    </Tooltip>
                                    <Tooltip title="关联资产库图片">
                                        <Button type="text" size="small" disabled={disabled} aria-label="关联资产库图片" icon={<ImagePlus className="size-4" />} onClick={() => onChooseImage(asset.id)} />
                                    </Tooltip>
                                    <Tooltip title="上传图片">
                                        <Button type="text" size="small" disabled={disabled} aria-label="上传图片" icon={<Upload className="size-4" />} onClick={() => onUploadImage(asset.id)} />
                                    </Tooltip>
                                    {asset.image ? (
                                        <Tooltip title="移除关联图片">
                                            <Button type="text" size="small" disabled={disabled} aria-label="移除关联图片" icon={<X className="size-4" />} onClick={() => onRemoveImage(asset.id)} />
                                        </Tooltip>
                                    ) : null}
                                    <Tooltip title="删除资产">
                                        <Button type="text" danger size="small" disabled={disabled} aria-label="删除资产" icon={<Trash2 className="size-4" />} onClick={() => onRemove(asset.id)} />
                                    </Tooltip>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="border-b py-3 text-sm text-[var(--studio-muted)]" style={{ borderColor: "var(--studio-line)" }}>
                    暂无{STORYBOARD_ASSET_KIND_LABELS[kind]}
                </div>
            )}
        </section>
    );
}

/** 根据资产类型设置预览画幅，尽量完整展示角色、场景和道具图片。 */
function storyboardAssetAspectRatio(kind: CanvasStoryboardAssetKind): string {
    if (kind === "character") return "3 / 4";
    if (kind === "scene") return "16 / 9";
    return "1 / 1";
}

type StoryboardAssetGenerationRowProps = {
    asset: CanvasStoryboardAsset;
    checked: boolean;
    status?: CanvasStoryboardAssetGenerationItemStatus;
    error?: string;
    disabled: boolean;
    onChange: (checked: boolean) => void;
};

/** 批量生成弹窗中的单项资产选择与状态行。 */
function StoryboardAssetGenerationRow({ asset, checked, status, error, disabled, onChange }: StoryboardAssetGenerationRowProps) {
    const statusLabel = status === "succeeded" ? "已完成" : status === "failed" ? "失败" : status === "running" ? "生成中" : status === "pending" ? "待生成" : "";
    return (
        <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-[var(--studio-surface-raised)]" style={{ borderColor: "var(--studio-line)" }}>
            <Checkbox checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
            <div className="size-16 shrink-0 overflow-hidden rounded-md" style={{ background: "var(--studio-surface-raised)" }}>
                {asset.image?.source ? (
                    <img src={asset.image.source} alt={asset.name || "资产图片"} className="size-full object-cover" />
                ) : (
                    <div className="grid size-full place-items-center px-1 text-center text-[10px] text-[var(--studio-muted)]">暂无图片</div>
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{asset.name || "未命名资产"}</span>
                    {statusLabel ? <span className="text-xs text-[var(--studio-muted)]">{statusLabel}</span> : null}
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-[var(--studio-muted)]">{asset.description || "暂无资产描述"}</p>
                {error ? <p className="mt-1 line-clamp-2 text-xs text-[var(--studio-danger)]">{error}</p> : null}
            </div>
        </label>
    );
}

type ShotColumnOptions = {
    editable: boolean;
    assets: CanvasStoryboardAsset[];
    composingShotId: string | null;
    onUpdate?: (shotId: string, patch: Partial<CanvasStoryboardShot>) => void;
    onDelete?: (shotId: string) => void;
    onComposePrompt?: (shotId: string) => void;
};

type StoryboardTextField = Exclude<keyof CanvasStoryboardShot, "id" | "shotNumber" | "durationSeconds" | "shotSize" | "assetIds">;

/** 构建单列表分镜工作区的高密度镜头表格列。 */
function buildShotColumns({ editable, assets, composingShotId, onUpdate, onDelete, onComposePrompt }: ShotColumnOptions): ColumnsType<CanvasStoryboardShot> {
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const assetOptions = ASSET_KINDS.map((kind) => ({
        label: STORYBOARD_ASSET_KIND_LABELS[kind],
        options: assets
            .filter((asset) => asset.kind === kind)
            .map((asset) => ({ value: asset.id, label: asset.name || "未命名资产" })),
    })).filter((group) => group.options.length);
    const renderText = (shot: CanvasStoryboardShot, field: StoryboardTextField, placeholder: string) => {
        const value = String(shot[field] || "");
        if (!editable) return <span className="whitespace-pre-wrap text-sm">{value || <span className="text-[var(--studio-muted)]">{placeholder}</span>}</span>;
        return <Input.TextArea size="small" value={value} placeholder={placeholder} autoSize={{ minRows: 1, maxRows: 5 }} onChange={(event) => onUpdate?.(shot.id, { [field]: event.target.value })} />;
    };
    const renderAssociatedAssets = (shot: CanvasStoryboardShot) => {
        if (editable) {
            return (
                <Select
                    mode="multiple"
                    size="small"
                    className="w-full"
                    value={shot.assetIds}
                    options={assetOptions}
                    maxTagCount="responsive"
                    placeholder="选择关联资产"
                    onChange={(assetIds: string[]) => onUpdate?.(shot.id, { assetIds })}
                />
            );
        }
        const associatedAssets = shot.assetIds.map((assetId) => assetsById.get(assetId)).filter((asset): asset is CanvasStoryboardAsset => Boolean(asset));
        return associatedAssets.length ? (
            <div className="flex flex-wrap gap-1">
                {associatedAssets.map((asset) => (
                    <Tag key={asset.id} className="m-0" style={{ borderColor: "var(--studio-line-strong)", background: "var(--studio-surface-raised)", color: "var(--studio-text)" }}>
                        {STORYBOARD_ASSET_KIND_LABELS[asset.kind]}: {asset.name || "未命名资产"}
                    </Tag>
                ))}
            </div>
        ) : (
            <span className="text-sm text-[var(--studio-muted)]">未关联</span>
        );
    };
    const renderFinalPrompt = (shot: CanvasStoryboardShot) => {
        const value = shot.finalPrompt || "";
        if (!editable) return <span className="whitespace-pre-wrap text-sm">{value || <span className="text-[var(--studio-muted)]">待生成提示词</span>}</span>;
        const generatingCurrentShot = composingShotId === shot.id;
        return (
            <div className="flex min-w-0 items-start gap-1">
                <Input.TextArea className="min-w-0 flex-1" size="small" value={value} disabled={generatingCurrentShot} placeholder="待生成提示词" autoSize={{ minRows: 1, maxRows: 5 }} onChange={(event) => onUpdate?.(shot.id, { finalPrompt: event.target.value })} />
                <Tooltip title="AI 生成当前镜头的最终提示词">
                    <Button
                        type="text"
                        size="small"
                        aria-label="AI生成当前镜头最终提示词"
                        icon={<Sparkles className="size-4" />}
                        loading={generatingCurrentShot}
                        disabled={Boolean(composingShotId) && !generatingCurrentShot}
                        onClick={() => onComposePrompt?.(shot.id)}
                    />
                </Tooltip>
            </div>
        );
    };
    return [
        {
            title: "镜号",
            dataIndex: "shotNumber",
            width: 74,
            render: (value: number, shot) =>
                editable ? <InputNumber size="small" min={1} precision={0} value={value} className="w-full" onChange={(nextValue) => typeof nextValue === "number" && onUpdate?.(shot.id, { shotNumber: nextValue })} /> : <span>{value}</span>,
        },
        {
            title: "时长",
            dataIndex: "durationSeconds",
            width: 90,
            render: (value: number, shot) =>
                editable ? (
                    <InputNumber size="small" min={1} max={600} precision={0} suffix="s" value={value} className="w-full" onChange={(nextValue) => typeof nextValue === "number" && onUpdate?.(shot.id, { durationSeconds: nextValue })} />
                ) : (
                    <span>{value}s</span>
                ),
        },
        { title: "画面描述", dataIndex: "visualDescription", width: 280, render: (_value, shot) => renderText(shot, "visualDescription", "描述画面") },
        {
            title: "景别",
            dataIndex: "shotSize",
            width: 190,
            render: (value: CanvasStoryboardShot["shotSize"], shot) =>
                editable ? (
                    <Select
                        size="small"
                        value={value}
                        className="w-full"
                        options={STORYBOARD_SHOT_SIZES.map((item) => ({ value: item.value, label: `${item.value} - ${item.englishPrompt}` }))}
                        onChange={(nextValue) => onUpdate?.(shot.id, { shotSize: nextValue })}
                    />
                ) : (
                    <span>{value}</span>
                ),
        },
        { title: "光影氛围", dataIndex: "lightingAtmosphere", width: 210, render: (_value, shot) => renderText(shot, "lightingAtmosphere", "补充光影氛围") },
        { title: "对白·旁白", dataIndex: "dialogueVoiceover", width: 210, render: (_value, shot) => renderText(shot, "dialogueVoiceover", "补充对白或旁白") },
        { title: "音效", dataIndex: "soundEffect", width: 190, render: (_value, shot) => renderText(shot, "soundEffect", "补充音效") },
        { title: "运镜", dataIndex: "cameraMovement", width: 190, render: (_value, shot) => renderText(shot, "cameraMovement", "补充运镜") },
        { title: "关联资产", dataIndex: "assetIds", width: 240, render: (_value, shot) => renderAssociatedAssets(shot) },
        { title: "最终提示词", dataIndex: "finalPrompt", width: 340, render: (_value, shot) => renderFinalPrompt(shot) },
        ...(editable
            ? [
                  {
                          title: "操作",
                      key: "operation",
                      fixed: "right" as const,
                      width: 68,
                          render: (_value: unknown, shot: CanvasStoryboardShot) => (
                              <Tooltip title="删除镜头">
                              <Button type="text" danger disabled={composingShotId === shot.id} aria-label="删除镜头" icon={<Trash2 className="size-4" />} onClick={() => onDelete?.(shot.id)} />
                          </Tooltip>
                      ),
                  },
              ]
            : []),
    ];
}

function createStoryboardShot(shotNumber: number): CanvasStoryboardShot {
    return {
        id: nanoid(),
        shotNumber,
        durationSeconds: 5,
        visualDescription: "",
        shotSize: "中景",
        lightingAtmosphere: "",
        dialogueVoiceover: "",
        soundEffect: "",
        cameraMovement: "",
        finalPrompt: "",
        assetIds: [],
    };
}

function createStoryboardAsset(kind: CanvasStoryboardAssetKind): CanvasStoryboardAsset {
    return { id: nanoid(), kind, name: "", description: "" };
}

function readImageAssetSource(asset: ImageAsset): string {
    return asset.data.dataUrl || asset.coverUrl;
}

function createDefaultAssetImageSettings(config: { imageModel: string; model: string; quality: string; imageResolution: string; size: string }): CanvasStoryboardAssetGenerationSettings {
    return {
        model: config.imageModel || config.model,
        quality: config.quality || "medium",
        imageResolution: config.imageResolution || "2K",
        size: config.size || "1:1",
    };
}
