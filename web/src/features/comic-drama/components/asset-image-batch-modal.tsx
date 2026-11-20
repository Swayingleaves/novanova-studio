"use client";

import type { CreditAmount } from "@/shared/lib/credit-amounts";

import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Modal, Select, Space } from "antd";
import { Sparkles } from "lucide-react";

import { useTranslation } from "@/features/locale/use-translation";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { estimateComicDramaGeneration } from "@/services/api/comic-drama";
import { assetImageShapeHint, defaultAssetGenSize, getAssetGenSizeOptions } from "../lib/asset-image-options";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaAssetType } from "../types";

/**
 * 批量生成资产图弹窗：选择模型、画质、清晰度、比例，弹出即按所选模型实时显示总积分，确认后一次性创建任务。
 * 资产库的批量生成与镜头清单的「生成本镜头资产」共用。
 */
export function AssetImageBatchModal({ open, versionIds, assetTypes, notice, onClose, onSubmitted }: {
    open: boolean;
    /** 要生成的资产版本，调用方已剔除生成中的版本。 */
    versionIds: string[];
    assetTypes: ComicDramaAssetType[];
    /** 目标数量之外的补充说明，如跳过的资产。 */
    notice?: ReactNode;
    onClose: () => void;
    onSubmitted?: () => void;
}) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const workspace = useComicDramaStore((state) => state.workspace);
    const createGenerationTask = useComicDramaStore((state) => state.createGenerationTask);
    const [model, setModel] = useState("");
    const [quality, setQuality] = useState("medium");
    const [resolution, setResolution] = useState("2K");
    const [size, setSize] = useState("1:1");
    const [credits, setCredits] = useState<CreditAmount | null>(null);
    const [estimating, setEstimating] = useState(false);
    const [generating, setGenerating] = useState(false);
    const aspectRatio = workspace?.settings.aspectRatio || "";
    const typesKey = assetTypes.join(",");
    const idsKey = versionIds.join(",");

    // 每次打开按用户默认配置重置参数
    useEffect(() => {
        if (!open) return;
        setModel(config.imageModel || "");
        setQuality(config.quality || "medium");
        setResolution(config.imageResolution || "2K");
        setSize(defaultAssetGenSize(typesKey ? (typesKey.split(",") as ComicDramaAssetType[]) : [], aspectRatio));
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // 弹窗打开后按当前所选参数实时估算总积分
    useEffect(() => {
        if (!open || !model || !workspace || versionIds.length === 0) {
            setCredits(null);
            return;
        }
        let cancelled = false;
        setEstimating(true);
        estimateComicDramaGeneration({
            projectId: workspace.projectId,
            targetType: "assetVersion",
            targetIds: versionIds,
            model,
            settings: { mediaType: "image", quality, resolution, size },
        })
            .then((res) => { if (!cancelled) setCredits(res.estimatedCredits); })
            .catch(() => { if (!cancelled) setCredits(null); })
            .finally(() => { if (!cancelled) setEstimating(false); });
        return () => { cancelled = true; };
    }, [open, model, quality, resolution, size, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleGenerate = async () => {
        if (!model) {
            message.warning(translate("comicDrama.selectAGenerationModelFirst"));
            return;
        }
        if (versionIds.length === 0) {
            message.warning(translate("comicDrama.noneOfTheSelectedAssetsHaveVersions"));
            return;
        }
        setGenerating(true);
        try {
            const result = await createGenerationTask({
                targetType: "assetVersion",
                targetIds: versionIds,
                model,
                settings: { mediaType: "image", quality, resolution, size },
            });
            message.success(translate("comicDrama.createdCountAssetImageTasksCheckProgressInTheMedia", { value0: result.taskCount }));
            onSubmitted?.();
            onClose();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setGenerating(false);
        }
    };

    return (
        <Modal title={translate("comicDrama.generateAssetImagesInBatch")} open={open} onCancel={onClose} footer={null} width={600}>
            <div className="flex flex-col gap-4 py-2">
                <div className="rounded-lg bg-[var(--studio-panel-solid)] p-3 text-xs leading-5 text-[var(--studio-muted)]">
                    {translate("comicDrama.batchAssetTargets", { value0: versionIds.length })}
                    {notice}
                </div>
                <div>
                    <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.generationModel")}</label>
                    <div className="mt-1">
                        <ModelPicker config={config} capability="image" value={model} onChange={setModel} fullWidth />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.imageQuality")}</label>
                        <Select
                            className="mt-1 w-full"
                            value={quality}
                            onChange={setQuality}
                            options={[
                                { value: "low", label: translate("comicDrama.lowQuality") },
                                { value: "medium", label: translate("comicDrama.standardQuality") },
                                { value: "high", label: translate("comicDrama.highQuality") },
                            ]}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.resolution")}</label>
                        <Select
                            className="mt-1 w-full"
                            value={resolution}
                            onChange={setResolution}
                            options={[{ value: "1K", label: "1K" }, { value: "2K", label: "2K" }, { value: "4K", label: "4K" }]}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.aspectRatio")}</label>
                        <Select className="mt-1 w-full" value={size} onChange={setSize} options={getAssetGenSizeOptions(translate)} />
                    </div>
                </div>
                <div className="rounded-lg bg-[var(--studio-panel-solid)] p-3 text-xs leading-5 text-[var(--studio-muted)]">
                    {translate("comicDrama.theServerBuildsPromptsFromAssetAndVersionNames_bcf6cd", {
                        value0: workspace?.settings.visualStyle || translate("comicDrama.notSet_55a04b"),
                        value1: assetImageShapeHint(assetTypes, translate),
                    })}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-[var(--studio-line)] pt-3">
                    <div className="text-xs text-[var(--studio-muted)]">
                        {estimating ? "…" : credits !== null ? (
                            <span>{translate("comicDrama.estimatedCost_4225d2")}<strong className="text-amber-500">{credits}</strong> {translate("comicDrama.credits")}</span>
                        ) : null}
                    </div>
                    <Space>
                        <Button onClick={onClose}>{translate("comicDrama.cancel")}</Button>
                        <Button type="primary" loading={generating} disabled={versionIds.length === 0} icon={<Sparkles className="size-4" />} onClick={handleGenerate}>
                            {translate("comicDrama.generateCountImages_4f0a0a", { value0: versionIds.length })}
                        </Button>
                    </Space>
                </div>
            </div>
        </Modal>
    );
}
