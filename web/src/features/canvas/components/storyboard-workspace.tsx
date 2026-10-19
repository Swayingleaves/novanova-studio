"use client";
import { modelCreditBalance } from "@/features/team/credit-balance";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { creditAmount } from "@/shared/lib/credit-amounts";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


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
import { createStoryboardAssetKindLabels, readStoryboardAssetImageCost, readStoryboardModelCost, removeStoryboardAssetAndAssociations, STORYBOARD_ASSET_KIND_LABELS, STORYBOARD_SHOT_SIZES } from "../domain/storyboard";

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
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const theme = useCanvasTheme();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    useUserStore((state) => state.user?.creditBalance);
    useTeamStore((state) => state.wallets);
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
        [assets, imageKeyword, translate.locale],
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
            title: translate("canvas.deleteShot"),
            content: shot ? translate("canvas.deleteShotThisCannotBeUndone", { value0: shot.shotNumber }) : translate("canvas.deleteThisShotThisCannotBeUndone"),
            okText: translate("canvas.delete"),
            cancelText: translate("canvas.cancel"),
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
            title: translate("canvas.deleteAsset"),
            content: asset?.name ? translate("canvas.deleteAssetThisCannotBeUndone", { value0: asset.name }) : translate("canvas.deleteThisAssetThisCannotBeUndone"),
            okText: translate("canvas.delete"),
            cancelText: translate("canvas.cancel"),
            okButtonProps: { danger: true },
            onOk: () => onChangeStoryboard(node.id, (storyboard) => removeStoryboardAssetAndAssociations(storyboard, assetId)),
        });
    };

    const confirmRemoveAssetImage = (assetId: string) => {
        if (!node || editingLocked) return;
        const asset = node.storyboard.assets.find((item) => item.id === assetId);
        modal.confirm({
            title: translate("canvas.unlinkImage"),
            content: asset?.name ? translate("canvas.unlinkImageFromAsset", { value0: asset.name }) : translate("canvas.removeThisAssetSImageLink"),
            okText: translate("canvas.remove_6135d4"),
            cancelText: translate("canvas.cancel"),
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
            message.success(translate("canvas.assetImageLinked"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("canvas.failedToUploadAssetImage"));
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
        message.success(translate("canvas.assetLibraryImageLinked"));
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
        [composingShotId, editingLocked, node?.id, storyboardAssets, translate.locale],
    );
    const assetGeneration = node?.storyboard.assetGeneration;
    const assetGenerating = assetGeneration?.phase === "running";
    const selectedAssets = storyboardAssets.filter((asset) => selectedAssetIds.includes(asset.id));
    const assetUnitCost = readStoryboardAssetImageCost(effectiveConfig.modelCosts, assetImageSettings.model, 1);
    const assetTotalCredits = readStoryboardAssetImageCost(effectiveConfig.modelCosts, assetImageSettings.model, selectedAssets.length);
    const selectedAssetNameError = selectedAssets.find((asset) => !asset.name.trim());
    const assetModelCostConfigured = effectiveConfig.modelCosts.some((item) => item.taskType === "image" && item.model === assetImageSettings.model);
    const assetModelReady = Boolean(assetImageSettings.model && effectiveConfig.imageModels.includes(assetImageSettings.model) && assetModelCostConfigured && isAiConfigReady(effectiveConfig, assetImageSettings.model));
    const creditBalance = modelCreditBalance(assetImageSettings.model);
    const promptCreditBalance = modelCreditBalance(promptModel);
    const assetBalanceInsufficient = creditBalance !== null && creditBalance !== undefined && creditAmount(assetTotalCredits).greaterThan(creditBalance);
    const allAssetsSelected = Boolean(storyboardAssets.length) && selectedAssetIds.length === storyboardAssets.length;
    const someAssetsSelected = selectedAssetIds.length > 0 && !allAssetsSelected;
    const selectedPromptShots = shots.filter((shot) => selectedPromptShotIds.includes(shot.id));
    const promptModelCost = readStoryboardModelCost(effectiveConfig.modelCosts, promptModel);
    const promptTotalCredits = creditAmount(promptModelCost).times(selectedPromptShots.length).toFixed();
    const promptModelCostConfigured = effectiveConfig.modelCosts.some((item) => item.taskType === "text" && item.model === promptModel);
    const promptModelReady = Boolean(promptModel && effectiveConfig.textModels.includes(promptModel) && promptModelCostConfigured && isAiConfigReady(effectiveConfig, promptModel));
    const promptBalanceInsufficient = promptCreditBalance !== null && promptCreditBalance !== undefined && creditAmount(promptTotalCredits).greaterThan(promptCreditBalance);
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
            message.warning(translate("canvas.selectAtLeastOneShot"));
            return;
        }
        if (!promptModelReady) {
            onMissingTextModelConfig?.();
            message.error(translate("canvas.selectATextModelBeforeGeneratingFinalPrompts"));
            return;
        }
        if (promptBalanceInsufficient) {
            message.error(translate("canvas.insufficientCreditsShotsNeedAvailable", { value0: selectedPromptShots.length, value1: promptTotalCredits, value2: promptCreditBalance }));
            return;
        }
        modal.confirm({
            title: translate("canvas.generateFinalPrompt"),
            content: translate("canvas.generateFinalPromptsForSelectedShotsAtAnEstimated", { value0: selectedPromptShots.length, value1: promptTotalCredits }),
            okText: translate("canvas.confirmGeneration"),
            cancelText: translate("canvas.cancel"),
            onOk: () => {
                setPromptGenerationOpen(false);
                onComposePrompts(node.id, selectedPromptShots.map((shot) => shot.id), promptModel);
            },
        });
    };
    const assetAssociationCounts = useMemo(
        () => Object.fromEntries(storyboardAssets.map((asset) => [asset.id, shots.filter((shot) => shot.assetIds.includes(asset.id)).length])),
        [shots, storyboardAssets, translate.locale],
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
            message.warning(translate("canvas.selectAtLeastOneAsset"));
            return;
        }
        if (selectedAssetNameError) {
            message.error(translate("canvas.nameSelectedAssetsBeforeGeneratingImages"));
            return;
        }
        if (!assetModelReady) {
            onMissingImageModelConfig?.();
            message.error(translate("canvas.selectAnImageModelBeforeGeneratingAssets"));
            return;
        }
        if (assetBalanceInsufficient) {
            message.error(translate("canvas.insufficientCreditsAssetsNeedAvailable", { value0: selectedAssets.length, value1: assetTotalCredits, value2: creditBalance }));
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
        [assetImageSettings, effectiveConfig, translate.locale],
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
                title={translate("canvas.storyboardScript_b8ccbe")}
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
                            <span className="text-base font-semibold">{translate("canvas.shots")}</span>
                            <span className="text-sm text-[var(--studio-muted)]">{translate("canvas.total")}{shots.length} {translate("canvas.shots_2764fa")}</span>
                        </div>
                        <Button icon={<FolderOpen className="size-4" />} onClick={openAssetModal}>
                            {translate("canvas.assets_a940ce")}{storyboardAssets.length}）
                        </Button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-4">
                        <div className="flex min-h-full min-w-0 flex-col gap-4">
                            <div className="min-w-0">
                                <Table<CanvasStoryboardShot> rowKey="id" dataSource={shots} columns={columns} pagination={false} size="small" tableLayout="fixed" scroll={{ x: SHOT_TABLE_SCROLL_WIDTH }} locale={{ emptyText: translate("canvas.noShots") }} />
                            </div>
                            <Button className="w-fit" icon={<Plus className="size-4" />} disabled={editingLocked} onClick={addShot}>
                                {translate("canvas.addShot")}</Button>
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-6 py-3" style={{ borderColor: "var(--studio-line)" }}>
                        <Button icon={<ImagePlus className="size-4" />} disabled={editingLocked || !storyboardAssets.length} onClick={() => openAssetGeneration()}>
                            {translate("canvas.generateAllAssets")}{storyboardAssets.length} {translate("canvas.items_1f41b3")}</Button>
                        <Button type="primary" icon={<Sparkles className="size-4" />} loading={composing} disabled={editingLocked || !shots.length} onClick={openPromptGeneration}>
                            {translate("canvas.generateAllFinalPrompts")}{shots.length} {translate("canvas.shots_434648")}</Button>
                    </div>
                </div>
            </Modal>

            <Modal
                title={translate("canvas.selectFinalPromptsToGenerate")}
                open={promptGenerationOpen && open && Boolean(node)}
                onCancel={() => setPromptGenerationOpen(false)}
                width={960}
                destroyOnHidden={false}
                footer={[
                    <Button key="cancel" onClick={() => setPromptGenerationOpen(false)}>
                        {translate("canvas.cancel")}</Button>,
                    <Button
                        key="generate"
                        type="primary"
                        disabled={editingLocked || !selectedPromptShots.length || !promptModelReady || Boolean(promptBalanceInsufficient)}
                        onClick={confirmComposePrompts}
                    >
                        {translate("canvas.generateSelectedShots")}{selectedPromptShots.length} {translate("canvas.items_d98006")}{promptTotalCredits} {translate("canvas.credits_0aeb2f")}</Button>,
                ]}
            >
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <section className="min-w-0 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--studio-line)" }}>
                            <Checkbox checked={allPromptShotsSelected} indeterminate={somePromptShotsSelected} disabled={editingLocked} onChange={toggleAllPromptShots}>
                                {translate("canvas.selectAllCurrentShots")}{shots.length} {translate("canvas.items_22ba27")}</Checkbox>
                            <span className="text-xs text-[var(--studio-muted)]">{translate("canvas.selected")}{selectedPromptShots.length} {translate("canvas.items_3a1168")}</span>
                        </div>
                        <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                            {shots.map((shot) => (
                                <div key={shot.id} className="flex min-w-0 items-start gap-3 rounded-md border px-3 py-2.5" style={{ borderColor: "var(--studio-line)", background: "var(--studio-surface-raised)" }}>
                                    <Checkbox
                                        className="mt-0.5"
                                        aria-label={translate("canvas.selectShot", { value0: shot.shotNumber })}
                                        checked={selectedPromptShotIds.includes(shot.id)}
                                        disabled={editingLocked}
                                        onChange={(event) => setSelectedPromptShotIds((current) => (event.target.checked ? [...new Set([...current, shot.id])] : current.filter((id) => id !== shot.id)))}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                            <span className="font-semibold">{translate("canvas.shotNo")}{shot.shotNumber}</span>
                                            <span className="text-[var(--studio-muted)]">{shot.durationSeconds} {translate("canvas.s")}</span>
                                            <Tag className="m-0">{shot.shotSize}</Tag>
                                            {shot.finalPrompt ? <span className="text-amber-600">{translate("canvas.replacesTheExistingPrompt")}</span> : null}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-sm text-[var(--studio-muted)]">{shot.visualDescription || translate("canvas.noVisualDescription")}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                    <aside className="space-y-5 rounded-md border p-4" style={{ borderColor: "var(--studio-line)", background: "var(--studio-surface-raised)" }}>
                        <div>
                            <h3 className="text-sm font-semibold">{translate("canvas.compositionSettings")}</h3>
                            <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("canvas.eachShotIsBilledAtTheTextModelS")}</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[var(--studio-muted)]">{translate("canvas.textModel")}</label>
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
                                <span className="text-[var(--studio-muted)]">{translate("canvas.creditsPerShot")}</span>
                                <span>{promptModelCost}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 font-semibold">
                                <span>{translate("canvas.estimatedCost")}</span>
                                <span>{promptTotalCredits} {translate("canvas.credits_10939f")}</span>
                            </div>
                        </div>
                        {!promptModelReady ? <p className="text-xs text-red-500">{translate("canvas.selectAnAvailableTextModel")}</p> : null}
                        {promptBalanceInsufficient ? <p className="text-xs text-red-500">{translate("canvas.insufficientCreditsAvailable")}{creditBalance ?? 0} {translate("canvas.credits_10939f")}</p> : null}
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
                                <h2 className="text-lg font-semibold">{translate("canvas.storyboardAssets")}</h2>
                                <Tag className="m-0">{storyboardAssets.length} {translate("canvas.items_49ccde")}</Tag>
                            </div>
                            <p className="mt-1 text-sm text-[var(--studio-muted)]">{translate("canvas.manageCharactersScenesAndPropsClickImagesToView")}</p>
                        </div>
                        <Button icon={<ImagePlus className="size-4" />} disabled={editingLocked || !storyboardAssets.length} onClick={() => openAssetGeneration()}>
                            {translate("canvas.generateImagesInBatch")}</Button>
                    </div>
                    <div className="grid shrink-0 gap-3 sm:grid-cols-3">
                        <StoryboardAssetSummary label={translate("canvas.generatedImages")} value={`${generatedAssetCount}/${storyboardAssets.length}`} hint={translate("canvas.assetCompleteness")} />
                        <StoryboardAssetSummary label={translate("canvas.linkedShots")} value={String(Object.values(assetAssociationCounts).reduce((total, count) => total + count, 0))} hint={translate("canvas.assetShotLinks")} />
                        <StoryboardAssetSummary label={translate("canvas.pending")} value={String(Math.max(0, storyboardAssets.length - generatedAssetCount))} hint={translate("canvas.noGeneratedImages")} />
                    </div>
                    <Tabs
                        activeKey={activeAssetKind}
                        destroyOnHidden
                        className="flex min-h-0 flex-1 flex-col [&_.ant-tabs-body-holder]:min-h-0 [&_.ant-tabs-body-holder]:min-w-0 [&_.ant-tabs-body-holder]:flex-1 [&_.ant-tabs-body]:h-full [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full [&_.ant-tabs-tabpane]:min-h-0"
                        onChange={(key) => setActiveAssetKind(key as CanvasStoryboardAssetKind)}
                        items={ASSET_KINDS.map((kind) => {
                            const kindAssets = storyboardAssets.filter((asset) => asset.kind === kind);
                            return {
                                key: kind,
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        {createStoryboardAssetKindLabels(translate)[kind]}
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
                title={previewAsset?.name || translate("canvas.assetImage")}
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
                                alt={previewAsset.name || translate("canvas.assetImage")}
                                className="block max-h-[min(76dvh,800px)] max-w-full object-contain"
                                decoding="async"
                            />
                        </div>
                        <aside className="space-y-5 border-t p-5 lg:border-l lg:border-t-0" style={{ borderColor: "var(--studio-line)" }}>
                            <div>
                                <p className="text-xs font-medium text-[var(--studio-muted)]">{translate("canvas.assetType")}</p>
                                <p className="mt-1 text-sm font-semibold">{createStoryboardAssetKindLabels(translate)[previewAsset.kind]}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-[var(--studio-muted)]">{translate("canvas.linkShot")}</p>
                                <p className="mt-1 flex items-center gap-2 text-sm font-semibold"><Link2 className="size-4" aria-hidden="true" />{assetAssociationCounts[previewAsset.id] || 0} {translate("canvas.shots_2764fa")}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-[var(--studio-muted)]">{translate("canvas.assetDescription")}</p>
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--studio-muted)]">{previewAsset.description || translate("canvas.noAssetDescription")}</p>
                            </div>
                            <Button block icon={<Maximize2 className="size-4" />} onClick={() => window.open(previewAsset.image?.source, "_blank", "noopener,noreferrer")}>{translate("canvas.openOriginalInNewWindow")}</Button>
                        </aside>
                    </div>
                ) : null}
            </Modal>

            <Modal
                title={translate("canvas.generateAssetImagesInBatch")}
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
                        {translate("canvas.close")}</Button>,
                    <Button
                        key="generate"
                        type="primary"
                        loading={assetGenerating}
                        disabled={editingLocked || !selectedAssets.length || Boolean(selectedAssetNameError) || !assetModelReady || Boolean(assetBalanceInsufficient)}
                        onClick={startAssetGeneration}
                    >
                        {translate("canvas.generateSelectedAssets")}{selectedAssets.length} {translate("canvas.items_637210")}{assetTotalCredits} {translate("canvas.credits_0aeb2f")}</Button>,
                ]}
            >
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <section className="min-w-0 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--studio-line)" }}>
                            <Checkbox checked={allAssetsSelected} indeterminate={someAssetsSelected} disabled={assetGenerating} onChange={toggleAllAssets}>
                                {translate("canvas.selectAllCurrentAssets")}{storyboardAssets.length} {translate("canvas.items_1f41b3")}</Checkbox>
                            <span className="text-xs text-[var(--studio-muted)]">{translate("canvas.selected_6f2971")}{selectedAssets.length} {translate("canvas.items_49ccde")}</span>
                        </div>
                        <div className="max-h-[58vh] space-y-5 overflow-y-auto pr-1">
                            {ASSET_KINDS.map((kind) => {
                                const kindAssets = storyboardAssets.filter((asset) => asset.kind === kind);
                                if (!kindAssets.length) return null;
                                return (
                                    <div key={kind} className="space-y-2">
                                        <h3 className="text-sm font-semibold">{createStoryboardAssetKindLabels(translate)[kind]}</h3>
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
                            <h3 className="text-sm font-semibold">{translate("canvas.imageSettings")}</h3>
                            <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("canvas.eachAssetGeneratesOneImage")}</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-[var(--studio-muted)]">{translate("canvas.model")}</label>
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
                                <span className="text-[var(--studio-muted)]">{translate("canvas.creditsPerItem")}</span>
                                <strong>{assetUnitCost}</strong>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-[var(--studio-muted)]">{translate("canvas.estimatedCost")}</span>
                                <strong>{assetTotalCredits} {translate("canvas.credits_10939f")}</strong>
                            </div>
                            {creditBalance !== null && creditBalance !== undefined ? (
                                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--studio-muted)]">
                                    <span>{translate("canvas.currentBalance")}</span>
                                    <span>{creditBalance} {translate("canvas.credits_10939f")}</span>
                                </div>
                            ) : null}
                        </div>
                        {assetGenerating ? (
                            <div className="space-y-2">
                                <Progress percent={assetGeneration?.progress || 0} size="small" />
                                <p className="text-xs text-[var(--studio-muted)]">
                                    {translate("canvas.processed")}{assetGenerationCompletedCount}/{assetGeneration?.selectedAssetIds.length || selectedAssets.length} {translate("canvas.items_49ccde")}</p>
                            </div>
                        ) : null}
                        {!selectedAssets.length ? <p className="text-xs text-[var(--studio-danger)]">{translate("canvas.selectAtLeastOneAssetToGenerate")}</p> : null}
                        {selectedAssetNameError ? <p className="text-xs text-[var(--studio-danger)]">{translate("canvas.pleaseFillIn")}{selectedAssetNameError.name || translate("canvas.untitledAsset")}{translate("canvas.name")}</p> : null}
                        {!assetModelReady ? <p className="text-xs text-[var(--studio-danger)]">{translate("canvas.selectAnEnabledImageModelWithPricing")}</p> : null}
                        {assetBalanceInsufficient ? <p className="text-xs text-[var(--studio-danger)]">{translate("canvas.insufficientCreditsForSelectedAssets")}</p> : null}
                    </aside>
                </div>
            </Modal>

            <input ref={uploadInputRef} type="file" accept="image/*" hidden onChange={(event) => void handleImageUpload(event)} />
            <Modal title={translate("canvas.linkAssetLibraryImage")} open={Boolean(imagePickerAssetId)} onCancel={() => setImagePickerAssetId(null)} footer={null} width={900} destroyOnHidden>
                <div className="space-y-4">
                    <Input allowClear value={imageKeyword} placeholder={translate("canvas.searchImageAssets")} onChange={(event) => setImageKeyword(event.target.value)} />
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
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate("canvas.noImagesAvailableToLink")} className="py-10" />
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
    const translate = useTranslation();
    const gridClassName = kind === "scene"
        ? "grid gap-4 md:grid-cols-2"
        : "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between gap-4 border-b pb-2" style={{ borderColor: "var(--studio-line)" }}>
                <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">{createStoryboardAssetKindLabels(translate)[kind]}</h3>
                    <span className="rounded-full bg-[var(--studio-surface-raised)] px-2 py-0.5 text-xs text-[var(--studio-muted)]">{assets.length}</span>
                </div>
                <Button size="small" icon={<Plus className="size-4" />} disabled={disabled} onClick={onAdd}>
                    {translate("canvas.add")}{createStoryboardAssetKindLabels(translate)[kind]}
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
                                        aria-label={translate("canvas.viewFullImageOf", { value0: asset.name || translate("canvas.untitledAsset") })}
                                        onClick={() => onPreview(asset.id)}
                                    >
                                        <img src={asset.image.source} alt="" className="block size-full object-contain" loading="lazy" decoding="async" />
                                        <span className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-1.5 rounded-md bg-black/65 px-3 py-2 text-xs font-medium text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-visible/image:opacity-100 motion-reduce:transition-none">
                                            <Eye className="size-3.5" aria-hidden="true" />{translate("canvas.viewFullImage")}</span>
                                    </button>
                                ) : (
                                    <div className="grid size-full place-items-center text-xs text-[var(--studio-muted)]">{translate("canvas.noImageLinked_ed1975")}</div>
                                )}
                                {uploadingAssetId === asset.id ? <div className="absolute inset-0 grid place-items-center bg-black/45 text-xs text-white">{translate("canvas.uploading")}</div> : null}
                            </div>
                            <div className="min-w-0 space-y-2.5 p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-[var(--studio-muted)]">{translate("canvas.assetDetails")}</span>
                                    <span className="shrink-0 text-[11px] text-[var(--studio-muted)]">{translate("canvas.link")}{assetAssociationCounts[asset.id] || 0} {translate("canvas.shot")}</span>
                                </div>
                                <Input className="!font-medium" value={asset.name} disabled={disabled} placeholder={translate("canvas.assetName")} onChange={(event) => onUpdate(asset.id, { name: event.target.value })} />
                                <Input.TextArea value={asset.description} disabled={disabled} placeholder={translate("canvas.assetDescription")} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => onUpdate(asset.id, { description: event.target.value })} />
                                <div className="flex flex-wrap items-center justify-end gap-1 border-t pt-2" style={{ borderColor: "var(--studio-line)" }}>
                                    <Tooltip title={translate("canvas.regenerateWithAI")}>
                                        <Button type="text" size="small" disabled={disabled} aria-label={translate("canvas.regenerateWithAI")} icon={<RefreshCw className="size-4" />} onClick={() => onRegenerate(asset.id)} />
                                    </Tooltip>
                                    <Tooltip title={translate("canvas.linkAssetLibraryImage")}>
                                        <Button type="text" size="small" disabled={disabled} aria-label={translate("canvas.linkAssetLibraryImage")} icon={<ImagePlus className="size-4" />} onClick={() => onChooseImage(asset.id)} />
                                    </Tooltip>
                                    <Tooltip title={translate("canvas.uploadImage")}>
                                        <Button type="text" size="small" disabled={disabled} aria-label={translate("canvas.uploadImage")} icon={<Upload className="size-4" />} onClick={() => onUploadImage(asset.id)} />
                                    </Tooltip>
                                    {asset.image ? (
                                        <Tooltip title={translate("canvas.unlinkImage_db7433")}>
                                            <Button type="text" size="small" disabled={disabled} aria-label={translate("canvas.unlinkImage_db7433")} icon={<X className="size-4" />} onClick={() => onRemoveImage(asset.id)} />
                                        </Tooltip>
                                    ) : null}
                                    <Tooltip title={translate("canvas.deleteAsset")}>
                                        <Button type="text" danger size="small" disabled={disabled} aria-label={translate("canvas.deleteAsset")} icon={<Trash2 className="size-4" />} onClick={() => onRemove(asset.id)} />
                                    </Tooltip>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="border-b py-3 text-sm text-[var(--studio-muted)]" style={{ borderColor: "var(--studio-line)" }}>
                    {translate("canvas.noneYet")}{createStoryboardAssetKindLabels(translate)[kind]}
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
    const translate = useTranslation();
    const statusLabel = status === "succeeded" ? translate("canvas.completed") : status === "failed" ? translate("canvas.failed") : status === "running" ? translate("canvas.generating_969ef4") : status === "pending" ? translate("canvas.notGenerated") : "";
    return (
        <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-[var(--studio-surface-raised)]" style={{ borderColor: "var(--studio-line)" }}>
            <Checkbox checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
            <div className="size-16 shrink-0 overflow-hidden rounded-md" style={{ background: "var(--studio-surface-raised)" }}>
                {asset.image?.source ? (
                    <img src={asset.image.source} alt={asset.name || translate("canvas.assetImage")} className="size-full object-cover" />
                ) : (
                    <div className="grid size-full place-items-center px-1 text-center text-[10px] text-[var(--studio-muted)]">{translate("canvas.noImages")}</div>
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{asset.name || translate("canvas.untitledAsset")}</span>
                    {statusLabel ? <span className="text-xs text-[var(--studio-muted)]">{statusLabel}</span> : null}
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-[var(--studio-muted)]">{asset.description || translate("canvas.noAssetDescription")}</p>
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
            .map((asset) => ({ value: asset.id, label: asset.name || translate("canvas.untitledAsset") })),
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
                    placeholder={translate("canvas.selectLinkedAssets")}
                    onChange={(assetIds: string[]) => onUpdate?.(shot.id, { assetIds })}
                />
            );
        }
        const associatedAssets = shot.assetIds.map((assetId) => assetsById.get(assetId)).filter((asset): asset is CanvasStoryboardAsset => Boolean(asset));
        return associatedAssets.length ? (
            <div className="flex flex-wrap gap-1">
                {associatedAssets.map((asset) => (
                    <Tag key={asset.id} className="m-0" style={{ borderColor: "var(--studio-line-strong)", background: "var(--studio-surface-raised)", color: "var(--studio-text)" }}>
                        {STORYBOARD_ASSET_KIND_LABELS[asset.kind]}: {asset.name || translate("canvas.untitledAsset")}
                    </Tag>
                ))}
            </div>
        ) : (
            <span className="text-sm text-[var(--studio-muted)]">{translate("canvas.unlinked")}</span>
        );
    };
    const renderFinalPrompt = (shot: CanvasStoryboardShot) => {
        const value = shot.finalPrompt || "";
        if (!editable) return <span className="whitespace-pre-wrap text-sm">{value || <span className="text-[var(--studio-muted)]">{translate("canvas.promptAwaitingGeneration")}</span>}</span>;
        const generatingCurrentShot = composingShotId === shot.id;
        return (
            <div className="flex min-w-0 items-start gap-1">
                <Input.TextArea className="min-w-0 flex-1" size="small" value={value} disabled={generatingCurrentShot} placeholder={translate("canvas.promptAwaitingGeneration")} autoSize={{ minRows: 1, maxRows: 5 }} onChange={(event) => onUpdate?.(shot.id, { finalPrompt: event.target.value })} />
                <Tooltip title={translate("canvas.generateFinalShotPromptWithAI")}>
                    <Button
                        type="text"
                        size="small"
                        aria-label={translate("canvas.generateFinalShotPromptWithAI_089139")}
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
            title: translate("canvas.shotNo"),
            dataIndex: "shotNumber",
            width: 74,
            render: (value: number, shot) =>
                editable ? <InputNumber size="small" min={1} precision={0} value={value} className="w-full" onChange={(nextValue) => typeof nextValue === "number" && onUpdate?.(shot.id, { shotNumber: nextValue })} /> : <span>{value}</span>,
        },
        {
            title: translate("canvas.duration"),
            dataIndex: "durationSeconds",
            width: 90,
            render: (value: number, shot) =>
                editable ? (
                    <InputNumber size="small" min={1} max={600} precision={0} suffix="s" value={value} className="w-full" onChange={(nextValue) => typeof nextValue === "number" && onUpdate?.(shot.id, { durationSeconds: nextValue })} />
                ) : (
                    <span>{value}s</span>
                ),
        },
        { title: translate("canvas.visualDescription"), dataIndex: "visualDescription", width: 280, render: (_value, shot) => renderText(shot, "visualDescription", translate("canvas.describeTheScene")) },
        {
            title: translate("canvas.shotSize"),
            dataIndex: "shotSize",
            width: 190,
            render: (value: CanvasStoryboardShot["shotSize"], shot) =>
                editable ? (
                    <Select
                        size="small"
                        value={value}
                        className="w-full"
                        options={STORYBOARD_SHOT_SIZES.map((item) => ({ value: item.value, label: item.label }))}
                        onChange={(nextValue) => onUpdate?.(shot.id, { shotSize: nextValue })}
                    />
                ) : (
                    <span>{value}</span>
                ),
        },
        { title: translate("canvas.lighting"), dataIndex: "lightingAtmosphere", width: 210, render: (_value, shot) => renderText(shot, "lightingAtmosphere", translate("canvas.addLightingDetails")) },
        { title: translate("canvas.dialogueNarration"), dataIndex: "dialogueVoiceover", width: 210, render: (_value, shot) => renderText(shot, "dialogueVoiceover", translate("canvas.addDialogueOrNarration")) },
        { title: translate("canvas.soundEffect"), dataIndex: "soundEffect", width: 190, render: (_value, shot) => renderText(shot, "soundEffect", translate("canvas.addSoundEffects")) },
        { title: translate("canvas.cameraMovement"), dataIndex: "cameraMovement", width: 190, render: (_value, shot) => renderText(shot, "cameraMovement", translate("canvas.addCameraMovement")) },
        { title: translate("canvas.linkAsset"), dataIndex: "assetIds", width: 240, render: (_value, shot) => renderAssociatedAssets(shot) },
        { title: translate("canvas.finalPrompt"), dataIndex: "finalPrompt", width: 340, render: (_value, shot) => renderFinalPrompt(shot) },
        ...(editable
            ? [
                  {
                          title: translate("canvas.actions"),
                      key: "operation",
                      fixed: "right" as const,
                      width: 68,
                          render: (_value: unknown, shot: CanvasStoryboardShot) => (
                              <Tooltip title={translate("canvas.deleteShot")}>
                              <Button type="text" danger disabled={composingShotId === shot.id} aria-label={translate("canvas.deleteShot")} icon={<Trash2 className="size-4" />} onClick={() => onDelete?.(shot.id)} />
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
