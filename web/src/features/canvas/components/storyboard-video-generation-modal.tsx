"use client";
import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";


import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Modal, Tag } from "antd";
import { Clapperboard } from "lucide-react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { VideoSettingsPanel } from "@/features/generation/components/video-settings-panel";
import { videoGenerationModeLabel, videoModelSupportsMode } from "@/features/generation/lib/video-billing";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { isAgnesVideoConfig } from "@/features/generation/lib/agnes-video";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import {
    quoteStoryboardVideo,
    readStoryboardShotReferenceImages,
    readStoryboardVideoCost,
    readStoryboardVideoGenerationModes,
    readStoryboardVideoReferenceIssue,
    readStoryboardVideoResolutionOptions,
    readStoryboardVideoShotIssue,
} from "../domain/storyboard";
import type { CanvasStoryboardAsset, CanvasStoryboardNode, CanvasStoryboardShot } from "../types";
import type { ReferenceVideo } from "@/features/generation/types/media";
import { useCanvasTheme } from "./canvas-theme-provider";

export type StoryboardVideoGenerationSettings = Pick<AiConfig, "size" | "vquality" | "videoSeconds" | "videoWatermark" | "videoGenerationMode">;

type StoryboardVideoGenerationModalProps = {
    open: boolean;
    node: CanvasStoryboardNode | null;
    generating: boolean;
    /** 画布连入分镜节点的视频参考，批量应用到全部选中镜头。 */
    referenceVideos?: ReferenceVideo[];
    onClose: () => void;
    onGenerate: (nodeId: string, shotIds: string[], model: string, settings: StoryboardVideoGenerationSettings) => void;
    onMissingVideoModelConfig?: () => void;
};

/** 分镜镜头批量视频生成选择弹窗。 */
export function StoryboardVideoGenerationModal({ open, node, generating, referenceVideos = [], onClose, onGenerate, onMissingVideoModelConfig }: StoryboardVideoGenerationModalProps) {
    const translate = useTranslation();
    const { message, modal } = App.useApp();
    const theme = useCanvasTheme();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const creditBalance = useUserStore((state) => state.user?.creditBalance);
    const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
    const [videoModel, setVideoModel] = useState("");
    const [videoSettings, setVideoSettings] = useState<StoryboardVideoGenerationSettings>(() => readVideoSettings(effectiveConfig));

    const videoConfig = useMemo(() => ({ ...effectiveConfig, ...videoSettings, model: videoModel, videoModel, count: "1", canvasVideoCount: "1" }), [effectiveConfig, videoModel, videoSettings, translate.locale]);
    const isAgnesVideo = useMemo(() => isAgnesVideoConfig(videoConfig), [videoConfig, translate.locale]);
    const shotStates = useMemo(() => {
        const assets = node?.storyboard.assets || [];
        return (node?.storyboard.shots || []).map((shot) => {
            const referenceImageCount = readStoryboardShotReferenceImages(shot, assets).length;
            return { shot, referenceImageCount, referenceVideoCount: referenceVideos.length, issue: readShotIssue(shot, assets, videoModel, videoConfig, referenceVideos) };
        });
    }, [node?.storyboard.assets, node?.storyboard.shots, referenceVideos, videoConfig, videoModel, translate.locale]);
    const selectableShotIds = useMemo(() => shotStates.filter((item) => !item.issue).map((item) => item.shot.id), [shotStates, translate.locale]);
    const selectableShotIdsKey = selectableShotIds.join("|");

    useEffect(() => {
        if (!open || !node) return;
        setVideoModel(effectiveConfig.videoModel);
        setVideoSettings(readVideoSettings(effectiveConfig));
        setSelectedShotIds(node.storyboard.shots.filter((shot) => Boolean(shot.finalPrompt.trim()) && Number.isSafeInteger(shot.durationSeconds) && shot.durationSeconds > 0).map((shot) => shot.id));
    }, [effectiveConfig.size, effectiveConfig.videoGenerationMode, effectiveConfig.videoModel, effectiveConfig.videoSeconds, effectiveConfig.videoWatermark, effectiveConfig.vquality, node?.id, open]);

    useEffect(() => {
        if (!open) return;
        const selectableShotIdSet = new Set(selectableShotIds);
        setSelectedShotIds((current) => current.filter((shotId) => selectableShotIdSet.has(shotId)));
    }, [open, selectableShotIdsKey]);

    const selectedShots = useMemo(() => {
        const selectedShotIdSet = new Set(selectedShotIds);
        return shotStates.filter((item) => !item.issue && selectedShotIdSet.has(item.shot.id)).map((item) => item.shot);
    }, [selectedShotIds, shotStates, translate.locale]);
    const automaticModes = useMemo(() => readStoryboardVideoGenerationModes(node?.storyboard.shots || [], node?.storyboard.assets || [], referenceVideos), [node?.storyboard.assets, node?.storyboard.shots, referenceVideos, translate.locale]);
    const storyboardModelOptions = useMemo(() => effectiveConfig.videoModels.filter((model) => automaticModes.every((mode) => videoModelSupportsMode(effectiveConfig, model, mode))), [automaticModes, effectiveConfig, translate.locale]);
    const storyboardResolutionOptions = useMemo(
        () => readStoryboardVideoResolutionOptions(effectiveConfig, videoModel, selectedShots.length ? selectedShots : node?.storyboard.shots || [], node?.storyboard.assets || [], referenceVideos),
        [effectiveConfig, node?.storyboard.assets, node?.storyboard.shots, referenceVideos, selectedShots, videoModel, translate.locale],
    );
    const modelReady = Boolean(videoModel && storyboardModelOptions.includes(videoModel) && isAiConfigReady(effectiveConfig, videoModel));
    const videoQuote = readStoryboardVideoCost(effectiveConfig, videoModel, videoConfig, selectedShots, node?.storyboard.assets || [], referenceVideos);
    const totalCredits = videoQuote.available ? videoQuote.credits : null;
    const balanceInsufficient = typeof creditBalance === "number" && totalCredits !== null && totalCredits > creditBalance;
    const allSelected = Boolean(selectableShotIds.length) && selectedShots.length === selectableShotIds.length;
    const partiallySelected = selectedShots.length > 0 && !allSelected;
    const creditUnit = effectiveConfig.videoModelBillingConfigurations.find((item) => item.model === videoModel)?.videoBillingConfiguration?.billingUnit;

    const toggleAll = () => setSelectedShotIds(allSelected ? [] : selectableShotIds);
    const toggleShot = (shotId: string, checked: boolean) => {
        setSelectedShotIds((current) => (checked ? [...new Set([...current, shotId])] : current.filter((id) => id !== shotId)));
    };
    const handleVideoSettingsChange = useCallback((key: keyof StoryboardVideoGenerationSettings, value: string) => {
        setVideoSettings((current) => (current[key] === value ? current : { ...current, [key]: value }));
    }, []);
    const confirmGenerate = () => {
        if (!node || generating) return;
        if (!selectedShots.length) {
            message.warning(translate("canvas.selectAtLeastOneEligibleVideoShot"));
            return;
        }
        if (!modelReady) {
            onMissingVideoModelConfig?.();
            message.error(translate("canvas.selectAnAvailableVideoModelFirst"));
            return;
        }
        if (!videoQuote.available) {
            message.error(videoQuote.reason);
            return;
        }
        if (balanceInsufficient) {
            message.error(translate("canvas.insufficientCreditsVideosNeedAvailable", { value0: selectedShots.length, value1: totalCredits, value2: creditBalance }));
            return;
        }
        modal.confirm({
            title: translate("canvas.confirmBatchVideoGeneration"),
            content: translate("canvas.confirmBatchVideoGenerationDetails", { value0: videoConfig.size || translate("canvas.auto"), value1: videoConfig.vquality || translate("canvas.default"), value2: selectedShots.length, value3: totalCredits }),
            okText: translate("canvas.confirmGeneration"),
            cancelText: translate("canvas.cancel"),
            onOk: () => {
                onGenerate(
                    node.id,
                    selectedShots.map((shot) => shot.id),
                    videoModel,
                    { ...videoSettings },
                );
                onClose();
            },
        });
    };

    return (
        <Modal
            title={translate("canvas.generateStoryboardVideosInBatch")}
            open={open && Boolean(node)}
            onCancel={onClose}
            width={1180}
            destroyOnHidden={false}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    {translate("canvas.cancel")}</Button>,
                <Button key="generate" type="primary" icon={<Clapperboard className="size-4" />} loading={generating} disabled={!selectedShots.length || !modelReady || !videoQuote.available || balanceInsufficient} onClick={confirmGenerate}>
                    {translate("canvas.generateSelectedShots")}{selectedShots.length} {translate("canvas.items_d98006")}{totalCredits === null ? translate("canvas.quoteUnavailable") : translate("canvas.credits", { value0: totalCredits })}）
                </Button>,
            ]}
        >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <section className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: theme.node.stroke }}>
                        <Checkbox checked={allSelected} indeterminate={partiallySelected} disabled={!selectableShotIds.length || generating} onChange={toggleAll}>
                            {translate("canvas.selectAllEligibleShots")}{selectableShotIds.length} {translate("canvas.items_22ba27")}</Checkbox>
                        <span className="text-xs text-[var(--studio-muted)]">{translate("canvas.selected")}{selectedShots.length} {translate("canvas.items_3a1168")}</span>
                    </div>
                    <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                        {shotStates.map(({ shot, referenceImageCount, referenceVideoCount, issue }) => {
                            const selectable = !issue;
                            const referenceLabel =
                                [referenceImageCount === 0 ? "" : isAgnesVideo && referenceImageCount >= 2 && referenceImageCount <= 3 ? translate("canvas.keyframes", { value0: referenceImageCount }) : translate("canvas.referenceImages", { value0: referenceImageCount }), referenceVideoCount > 0 ? translate("canvas.videoReferences", { value0: referenceVideoCount }) : ""].filter(Boolean).join("，") || translate("canvas.noReferences");
                            return (
                                <div key={shot.id} className="flex min-w-0 items-start gap-3 rounded-md border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                                    <Checkbox
                                        className="mt-0.5"
                                        aria-label={translate("canvas.selectShot", { value0: shot.shotNumber })}
                                        checked={selectable && selectedShotIds.includes(shot.id)}
                                        disabled={!selectable || generating}
                                        onChange={(event) => toggleShot(shot.id, event.target.checked)}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                            <span className="font-semibold">{translate("canvas.shotNo")}{shot.shotNumber}</span>
                                            <span className="text-[var(--studio-muted)]">{shot.durationSeconds} {translate("canvas.s")}</span>
                                            <Tag className="m-0">{shot.shotSize}</Tag>
                                            <span className="text-[var(--studio-muted)]">{referenceLabel}</span>
                                            {issue ? <span className="text-red-500">{issue}</span> : <span className="text-emerald-600">{translate("canvas.readyToGenerate")}</span>}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-sm text-[var(--studio-muted)]">{shot.visualDescription || translate("canvas.noVisualDescription")}</p>
                                        {shot.finalPrompt.trim() ? <p className="mt-1 line-clamp-2 text-xs text-[var(--studio-muted)]">{shot.finalPrompt}</p> : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
                <aside className="max-h-[58vh] space-y-5 overflow-y-auto rounded-md border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                    <div>
                        <h3 className="text-sm font-semibold">{translate("canvas.videoSettings")}</h3>
                        <p className="mt-1 text-xs text-[var(--studio-muted)]">{translate("canvas.aspectRatioAndResolutionAreConfigurableDurationFollowsEach")}</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-[var(--studio-muted)]">{translate("canvas.videoModel")}</label>
                        <ModelPicker config={effectiveConfig} value={videoModel} capability="video" modelOptions={storyboardModelOptions} fullWidth onChange={setVideoModel} onMissingConfig={onMissingVideoModelConfig} />
                    </div>
                    <VideoSettingsPanel
                        config={videoConfig}
                        onConfigChange={handleVideoSettingsChange}
                        theme={theme}
                        showTitle={false}
                        showGenerationMode={false}
                        showDuration={false}
                        resolutionOptions={storyboardResolutionOptions}
                        className="space-y-4"
                    />
                    <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[var(--studio-muted)]">{translate("canvas.autoMode")}</span>
                            <span>{automaticModes.map(videoGenerationModeLabel).join(" / ") || translate("canvas.cannotGenerate")}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[var(--studio-muted)]">{translate("canvas.billingMethod")}</span>
                            <span>{creditUnit === "second" ? translate("canvas.perSecond") : creditUnit === "generation" ? translate("canvas.perRun") : translate("canvas.quoteUnavailable")}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 font-semibold">
                            <span>{translate("canvas.estimatedCost")}</span>
                            <span>{totalCredits === null ? translate("canvas.quoteUnavailable") : translate("canvas.credits", { value0: totalCredits })}</span>
                        </div>
                    </div>
                    {!modelReady ? <p className="text-xs text-red-500">{translate("canvas.selectAnEnabledVideoModelWithPricing")}</p> : null}
                    {!videoQuote.available ? <p className="text-xs text-red-500">{videoQuote.reason}</p> : null}
                    {balanceInsufficient ? <p className="text-xs text-red-500">{translate("canvas.insufficientCreditsAvailable")}{creditBalance ?? 0} {translate("canvas.credits_10939f")}</p> : null}
                </aside>
            </div>
        </Modal>
    );
}

function readVideoSettings(config: AiConfig): StoryboardVideoGenerationSettings {
    return {
        videoGenerationMode: config.videoGenerationMode,
        size: config.size,
        vquality: config.vquality,
        videoSeconds: config.videoSeconds,
        videoWatermark: config.videoWatermark,
    };
}

function readShotIssue(shot: CanvasStoryboardShot, assets: CanvasStoryboardAsset[], videoModel: string, videoConfig: AiConfig, referenceVideos: ReferenceVideo[]): string {
    if (!shot.finalPrompt.trim()) return translate("canvas.generateFinalPromptFirst");
    if (!Number.isSafeInteger(shot.durationSeconds) || shot.durationSeconds < 1) return translate("canvas.invalidShotDuration");
    if (!videoModel) return "";
    const issue = readStoryboardVideoShotIssue(shot, videoConfig) || readStoryboardVideoReferenceIssue(shot, assets, videoConfig);
    if (issue) return issue;
    const quote = quoteStoryboardVideo(videoConfig, videoModel, videoConfig, shot, assets, referenceVideos);
    return quote.available ? "" : quote.reason;
}
