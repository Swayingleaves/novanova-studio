"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Modal, Tag } from "antd";
import { Clapperboard } from "lucide-react";

import { useUserStore } from "@/features/auth/stores/use-user-store";
import { getModelCreditUnit } from "@/features/generation/constants/credits";
import { VideoSettingsPanel } from "@/features/generation/components/video-settings-panel";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { isAgnesVideoConfig } from "@/features/generation/lib/agnes-video";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import { readStoryboardShotReferenceImages, readStoryboardVideoCost, readStoryboardVideoReferenceIssue, readStoryboardVideoShotIssue } from "../domain/storyboard";
import type { CanvasStoryboardAsset, CanvasStoryboardNode, CanvasStoryboardShot } from "../types";
import { useCanvasTheme } from "./canvas-theme-provider";

export type StoryboardVideoGenerationSettings = Pick<AiConfig, "size" | "vquality" | "videoSeconds" | "videoWatermark">;

type StoryboardVideoGenerationModalProps = {
    open: boolean;
    node: CanvasStoryboardNode | null;
    generating: boolean;
    onClose: () => void;
    onGenerate: (nodeId: string, shotIds: string[], model: string, settings: StoryboardVideoGenerationSettings) => void;
    onMissingVideoModelConfig?: () => void;
};

/** 分镜镜头批量视频生成选择弹窗。 */
export function StoryboardVideoGenerationModal({ open, node, generating, onClose, onGenerate, onMissingVideoModelConfig }: StoryboardVideoGenerationModalProps) {
    const { message, modal } = App.useApp();
    const theme = useCanvasTheme();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const creditBalance = useUserStore((state) => state.user?.creditBalance);
    const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
    const [videoModel, setVideoModel] = useState("");
    const [videoSettings, setVideoSettings] = useState<StoryboardVideoGenerationSettings>(() => readVideoSettings(effectiveConfig));

    const videoConfig = useMemo(() => ({ ...effectiveConfig, ...videoSettings, model: videoModel, videoModel, count: "1", canvasVideoCount: "1" }), [effectiveConfig, videoModel, videoSettings]);
    const isAgnesVideo = useMemo(() => isAgnesVideoConfig(videoConfig), [videoConfig]);
    const shotStates = useMemo(() => {
        const assets = node?.storyboard.assets || [];
        return (node?.storyboard.shots || []).map((shot) => {
            const referenceImageCount = readStoryboardShotReferenceImages(shot, assets).length;
            return { shot, referenceImageCount, issue: readShotIssue(shot, assets, videoModel, videoConfig) };
        });
    }, [node?.storyboard.assets, node?.storyboard.shots, videoConfig, videoModel]);
    const selectableShotIds = useMemo(() => shotStates.filter((item) => !item.issue).map((item) => item.shot.id), [shotStates]);
    const selectableShotIdsKey = selectableShotIds.join("|");

    useEffect(() => {
        if (!open || !node) return;
        setVideoModel(effectiveConfig.videoModel);
        setVideoSettings(readVideoSettings(effectiveConfig));
        setSelectedShotIds(node.storyboard.shots.filter((shot) => Boolean(shot.finalPrompt.trim()) && Number.isSafeInteger(shot.durationSeconds) && shot.durationSeconds > 0).map((shot) => shot.id));
    }, [effectiveConfig.size, effectiveConfig.videoModel, effectiveConfig.videoSeconds, effectiveConfig.videoWatermark, effectiveConfig.vquality, node?.id, open]);

    useEffect(() => {
        if (!open) return;
        const selectableShotIdSet = new Set(selectableShotIds);
        setSelectedShotIds((current) => current.filter((shotId) => selectableShotIdSet.has(shotId)));
    }, [open, selectableShotIdsKey]);

    const selectedShots = useMemo(() => {
        const selectedShotIdSet = new Set(selectedShotIds);
        return shotStates.filter((item) => !item.issue && selectedShotIdSet.has(item.shot.id)).map((item) => item.shot);
    }, [selectedShotIds, shotStates]);
    const modelCostConfigured = effectiveConfig.modelCosts.some((item) => item.taskType === "video" && item.model === videoModel);
    const modelReady = Boolean(videoModel && effectiveConfig.videoModels.includes(videoModel) && modelCostConfigured && isAiConfigReady(effectiveConfig, videoModel));
    const totalCredits = readStoryboardVideoCost(effectiveConfig.modelCosts, videoModel, selectedShots);
    const balanceInsufficient = typeof creditBalance === "number" && totalCredits > creditBalance;
    const allSelected = Boolean(selectableShotIds.length) && selectedShots.length === selectableShotIds.length;
    const partiallySelected = selectedShots.length > 0 && !allSelected;
    const creditUnit = getModelCreditUnit(effectiveConfig.modelCosts, videoModel, "video");

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
            message.warning("请至少选择一个可生成视频的镜头");
            return;
        }
        if (!modelReady) {
            onMissingVideoModelConfig?.();
            message.error("请选择可用的视频模型后再生成");
            return;
        }
        if (balanceInsufficient) {
            message.error(`积分不足，生成 ${selectedShots.length} 个视频需要 ${totalCredits} 积分，当前可用 ${creditBalance} 积分`);
            return;
        }
        modal.confirm({
            title: "确认批量生成分镜视频",
            content: `将使用所选模型、${videoConfig.size || "自动"}比例和${videoConfig.vquality || "默认"}清晰度，为 ${selectedShots.length} 个镜头分别创建视频任务，预计消耗 ${totalCredits} 积分。是否继续？`,
            okText: "确认生成",
            cancelText: "取消",
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
            title="批量生成分镜视频"
            open={open && Boolean(node)}
            onCancel={onClose}
            width={1180}
            destroyOnHidden={false}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    取消
                </Button>,
                <Button key="generate" type="primary" icon={<Clapperboard className="size-4" />} loading={generating} disabled={!selectedShots.length || !modelReady || balanceInsufficient} onClick={confirmGenerate}>
                    生成已选镜头（{selectedShots.length} 个，{totalCredits} 积分）
                </Button>,
            ]}
        >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <section className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: theme.node.stroke }}>
                        <Checkbox checked={allSelected} indeterminate={partiallySelected} disabled={!selectableShotIds.length || generating} onChange={toggleAll}>
                            全选可生成镜头（{selectableShotIds.length} 个）
                        </Checkbox>
                        <span className="text-xs text-[var(--studio-muted)]">已选择 {selectedShots.length} 个</span>
                    </div>
                    <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                        {shotStates.map(({ shot, referenceImageCount, issue }) => {
                            const selectable = !issue;
                            const referenceLabel = referenceImageCount === 0 ? "无关联图片" : isAgnesVideo && referenceImageCount >= 2 && referenceImageCount <= 3 ? `${referenceImageCount} 张关键帧` : `${referenceImageCount} 张参考图`;
                            return (
                                <div key={shot.id} className="flex min-w-0 items-start gap-3 rounded-md border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                                    <Checkbox
                                        className="mt-0.5"
                                        aria-label={`选择镜号 ${shot.shotNumber}`}
                                        checked={selectable && selectedShotIds.includes(shot.id)}
                                        disabled={!selectable || generating}
                                        onChange={(event) => toggleShot(shot.id, event.target.checked)}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                            <span className="font-semibold">镜号 {shot.shotNumber}</span>
                                            <span className="text-[var(--studio-muted)]">{shot.durationSeconds} 秒</span>
                                            <Tag className="m-0">{shot.shotSize}</Tag>
                                            <span className="text-[var(--studio-muted)]">{referenceLabel}</span>
                                            {issue ? <span className="text-red-500">{issue}</span> : <span className="text-emerald-600">可生成</span>}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-sm text-[var(--studio-muted)]">{shot.visualDescription || "未填写画面描述"}</p>
                                        {shot.finalPrompt.trim() ? <p className="mt-1 line-clamp-2 text-xs text-[var(--studio-muted)]">{shot.finalPrompt}</p> : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
                <aside className="max-h-[58vh] space-y-5 overflow-y-auto rounded-md border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                    <div>
                        <h3 className="text-sm font-semibold">视频设置</h3>
                        <p className="mt-1 text-xs text-[var(--studio-muted)]">比例和清晰度可单独设置，时长固定使用每个镜头的分镜定义。</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-[var(--studio-muted)]">视频模型</label>
                        <ModelPicker config={effectiveConfig} value={videoModel} capability="video" fullWidth onChange={setVideoModel} onMissingConfig={onMissingVideoModelConfig} />
                    </div>
                    <VideoSettingsPanel config={videoConfig} onConfigChange={handleVideoSettingsChange} theme={theme} showTitle={false} showDuration={false} className="space-y-4" />
                    <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[var(--studio-muted)]">计费方式</span>
                            <span>{creditUnit === "second" ? "按秒计费" : "按次计费"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 font-semibold">
                            <span>预计消耗</span>
                            <span>{totalCredits} 积分</span>
                        </div>
                    </div>
                    {!modelReady ? <p className="text-xs text-red-500">请选择已启用且已配置价格的视频模型</p> : null}
                    {balanceInsufficient ? <p className="text-xs text-red-500">积分不足，当前可用 {creditBalance ?? 0} 积分</p> : null}
                </aside>
            </div>
        </Modal>
    );
}

function readVideoSettings(config: AiConfig): StoryboardVideoGenerationSettings {
    return {
        size: config.size,
        vquality: config.vquality,
        videoSeconds: config.videoSeconds,
        videoWatermark: config.videoWatermark,
    };
}

function readShotIssue(shot: CanvasStoryboardShot, assets: CanvasStoryboardAsset[], videoModel: string, videoConfig: AiConfig): string {
    if (!shot.finalPrompt.trim()) return "请先生成最终提示词";
    if (!Number.isSafeInteger(shot.durationSeconds) || shot.durationSeconds < 1) return "镜头时长无效";
    if (!videoModel) return "";
    return readStoryboardVideoShotIssue(shot, videoConfig) || readStoryboardVideoReferenceIssue(shot, assets, videoConfig);
}
