"use client";

import type { CreditAmount } from "@/shared/lib/credit-amounts";


import { productionParameterLabel } from "../lib/production-labels";

import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Modal, Space, Spin } from "antd";
import { Coins, Sparkles } from "lucide-react";

import { VideoSettingsPanel, sizeFromAspectRatio } from "@/features/generation/components/video-settings-panel";
import { readVideoGenerationConstraintIssue } from "@/features/generation/lib/video-generation-constraints";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig, type VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import { useThemeStore } from "@/features/theme/stores/use-theme-store";
import { estimateComicDramaGeneration, readComicDramaMediaUrl } from "@/services/api/comic-drama";
import { canvasThemes } from "@/shared/lib/canvas-theme";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaPromptVersion, ComicDramaShot } from "../types";

type VideoConfigKey = "videoGenerationMode" | "vquality" | "size" | "videoSeconds" | "videoWatermark";

type ShotGenerationModalProps = {
    /** 弹窗是否可见 */
    open: boolean;
    /** 目标镜头 id；单个镜头即就地生成该镜头，多个镜头按同一套参数批量提交 */
    shotIds: string[];
    /** 关闭弹窗 */
    onClose: () => void;
};

/**
 * 分镜板就地配置并生成镜头视频的弹窗。
 *
 * 参数面板与提交载荷和「媒体生成中心」的生成弹窗保持同一套口径（同一 VideoSettingsPanel、
 * 同一 settings 键名），区别只是目标镜头由当前页面直接给定，因此不需要跳转阶段。
 * 传入多个镜头时按同一套参数批量提交，供分镜板右上角「批量媒体生成」使用。
 */
export function ShotGenerationModal({ open, shotIds, onClose }: ShotGenerationModalProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const workspace = useComicDramaStore((state) => state.workspace);
    const createGenerationTask = useComicDramaStore((state) => state.createGenerationTask);

    const [model, setModel] = useState<string>("");
    const [size, setSize] = useState<string>("16:9");
    const [vquality, setVquality] = useState<string>("720p");
    const [videoSeconds, setVideoSeconds] = useState<string>("5");
    /** 批量模式下勾选要生成的镜头，打开弹窗时默认全选 */
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [estimatedCredits, setEstimatedCredits] = useState<CreditAmount | null>(null);
    const [estimateError, setEstimateError] = useState("");
    const [estimating, setEstimating] = useState(false);
    const [generating, setGenerating] = useState(false);

    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const settingsTheme = canvasThemes[resolvedTheme];

    const shots = useMemo(
        () => shotIds.map((id) => workspace?.shots.find((item) => item.id === id)).filter((item): item is ComicDramaShot => Boolean(item)),
        [shotIds, workspace]
    );
    const isBatch = shotIds.length > 1;
    const activeShot = shots[0];
    const projectId = workspace?.projectId;
    const mediaList = workspace?.media || [];

    // 每个镜头各自使用其已采用的最终提示词，口径与镜头清单一致。
    const adoptedPrompts = useMemo(() => {
        const promptsByShotId = new Map<string, ComicDramaPromptVersion>();
        for (const prompt of workspace?.promptVersions || []) {
            if (prompt.status !== "adopted") continue;
            const current = promptsByShotId.get(prompt.shotId);
            if (!current || prompt.versionNumber > current.versionNumber) {
                promptsByShotId.set(prompt.shotId, prompt);
            }
        }
        return promptsByShotId;
    }, [workspace]);
    const finalVideoPrompt = activeShot ? adoptedPrompts.get(activeShot.id) || null : null;

    // 参考图数量：优先已采用的分镜图，其次该镜头绑定的资产图。有参考图按图生视频计，否则文生视频
    const referenceCountByShot = useMemo(() => {
        const counts = new Map<string, number>();
        for (const shot of shots) {
            let count = 0;
            const storyboardImage =
                mediaList.find((item) => item.targetType === "shot" && item.targetId === shot.id && item.mediaType === "image" && (item.status === "completed" || item.status === "needsUpdate") && item.adopted) ||
                mediaList.find((item) => item.targetType === "shot" && item.targetId === shot.id && item.mediaType === "image" && (item.status === "completed" || item.status === "needsUpdate"));
            if (storyboardImage && readComicDramaMediaUrl(storyboardImage.resultData)) count += 1;
            for (const versionId of shot.assetVersionIds || []) {
                const assetImage = mediaList.find((item) => item.targetType === "assetVersion" && item.targetId === versionId && item.mediaType === "image" && (item.status === "completed" || item.status === "needsUpdate"));
                if (assetImage && readComicDramaMediaUrl(assetImage.resultData)) count += 1;
            }
            counts.set(shot.id, count);
        }
        return counts;
    }, [mediaList, shots]);
    const referenceCount = activeShot ? referenceCountByShot.get(activeShot.id) || 0 : 0;

    // 批量只提交勾选的镜头，单镜头模式固定为当前镜头
    const targetShots = isBatch ? shots.filter((shot) => selectedIds.includes(shot.id)) : shots;
    const targetIds = targetShots.map((shot) => shot.id);
    const shotsWithPromptCount = targetShots.filter((shot) => adoptedPrompts.has(shot.id)).length;
    const shotsWithReferenceCount = targetShots.filter((shot) => (referenceCountByShot.get(shot.id) || 0) > 0).length;
    const allSelected = shots.length > 0 && targetShots.length === shots.length;
    const videoGenerationMode: VideoGenerationMode = (isBatch ? shotsWithReferenceCount > 0 : referenceCount > 0) ? "image-to-video" : "text-to-video";
    const constraintIssue = targetShots.map((shot) => {
        const imageCount = referenceCountByShot.get(shot.id) || 0;
        const issue = readVideoGenerationConstraintIssue({ config, model, mode: imageCount ? "image-to-video" : "text-to-video", size, seconds: videoSeconds, imageCount });
        return issue ? `${shot.shotNumber}：${issue}` : "";
    }).find(Boolean) || "";

    // 与生成页一致：适配器读 size/resolution/seconds
    const taskSettings = useMemo(
        () => ({
            mediaType: "video",
            size,
            resolution: vquality,
            seconds: videoSeconds,
            videoGenerationMode: isBatch ? undefined : videoGenerationMode,
        }),
        [size, vquality, videoSeconds, isBatch, videoGenerationMode]
    );

    // 每次打开都回到项目画幅与默认模型配置并默认全选镜头；单镜头沿用其分镜时长，批量时各镜头时长不一致，回落到默认视频时长。
    useEffect(() => {
        if (!open || shots.length === 0) return;
        setSelectedIds(shots.map((shot) => shot.id));
        setModel(config.videoModel || "");
        // 跟随项目生产设置的画面方向（9:16 等），并按当前模型换算成它接受的 size 取值
        setSize(sizeFromAspectRatio(config, workspace?.settings.aspectRatio));
        setVquality(config.vquality || "720p");
        setVideoSeconds(isBatch ? config.videoSeconds || "5" : String(activeShot?.durationSeconds || config.videoSeconds || "5"));
        setEstimatedCredits(null);
        // 只在打开的那一帧重置一次，避免配置变化打断正在调整的参数
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // 模型、勾选范围或任何影响计费的参数变化后自动估算总价，用户不需要再手点一次。
    const targetIdsKey = targetIds.join(",");
    useEffect(() => {
        setEstimateError("");
        if (!open || !projectId || !model || targetIds.length === 0 || constraintIssue) {
            setEstimatedCredits(null);
            setEstimating(false);
            return;
        }
        let cancelled = false;
        setEstimating(true);
        // 轻微延迟，避免快速连改参数时连续打请求
        const timer = setTimeout(() => {
            estimateComicDramaGeneration({ projectId, targetType: "shot", targetIds, model, settings: taskSettings })
                .then((res) => {
                    if (!cancelled) setEstimatedCredits(res.estimatedCredits);
                })
                .catch((error) => {
                    if (!cancelled) {
                        setEstimatedCredits(null);
                        setEstimateError(error instanceof Error ? error.message : translate("comicDrama.estimateFailed"));
                    }
                })
                .finally(() => {
                    if (!cancelled) setEstimating(false);
                });
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, projectId, model, targetIdsKey, taskSettings, constraintIssue]);

    const handleCreate = async () => {
        if (constraintIssue || estimateError) {
            message.warning(constraintIssue || estimateError);
            return;
        }
        if (!model) {
            message.warning(translate("comicDrama.selectAGenerationModelFirst"));
            return;
        }
        if (targetIds.length === 0) {
            message.warning(translate("comicDrama.selectAtLeastOneShot"));
            return;
        }
        setGenerating(true);
        try {
            const res = await createGenerationTask({ targetType: "shot", targetIds, model, settings: taskSettings });
            message.success(isBatch ? translate("comicDrama.createdCountVideoGenerationTasksStoryboardProgressWillUpdateAutomatically", { value0: res.taskCount }) : translate("comicDrama.videoGenerationTaskCreatedStoryboardProgressWillUpdateAutomatically"));
            onClose();
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleSettingChange = (key: VideoConfigKey, value: string) => {
        if (key === "size") setSize(value);
        else if (key === "vquality") setVquality(value);
        else if (key === "videoSeconds") setVideoSeconds(value);
    };

    return (
        <Modal
            title={isBatch ? translate("comicDrama.batchVideoGenerationCountCountSelected", { value0: targetShots.length, value1: shots.length }) : translate("comicDrama.generateVideoForShotCount", { value0: String(activeShot?.shotNumber || 0).padStart(2, "0") })}
            open={open}
            onCancel={onClose}
            footer={null}
            width={isBatch ? 1040 : 820}
            destroyOnHidden
        >
            <div className="flex gap-4 py-2">
                {/* 左：镜头勾选与剧情提示词 */}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--studio-line)] pb-2">
                        {isBatch ? (
                            <Checkbox
                                indeterminate={targetShots.length > 0 && !allSelected}
                                checked={allSelected}
                                onChange={(e) => setSelectedIds(e.target.checked ? shots.map((shot) => shot.id) : [])}
                            >
                                <span className="text-xs font-medium text-[var(--studio-ink)]">{translate("comicDrama.selectShotsToGenerate")}</span>
                            </Checkbox>
                        ) : (
                            <span className="text-xs font-medium text-[var(--studio-ink)]">{translate("comicDrama.shotPrompt")}</span>
                        )}
                        <span className="text-[10px] text-[var(--studio-muted)]">
                            {isBatch
                                ? translate("comicDrama.countSelectedAdoptedPromptsCountCount", { value0: targetShots.length, value1: shotsWithPromptCount, value2: targetShots.length })
                                : finalVideoPrompt
                                    ? translate("comicDrama.adoptedVCount", { value0: finalVideoPrompt.versionNumber })
                                    : translate("comicDrama.noFinalPromptAdoptedYet")}
                        </span>
                    </div>

                    <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-1">
                        {shots.map((shot) => {
                            const shotPrompt = adoptedPrompts.get(shot.id);
                            const selected = !isBatch || selectedIds.includes(shot.id);
                            return (
                                <div
                                    key={shot.id}
                                    onClick={
                                        isBatch
                                            ? () =>
                                                  setSelectedIds((current) =>
                                                      selected ? current.filter((id) => id !== shot.id) : [...current, shot.id]
                                                  )
                                            : undefined
                                    }
                                    className={`rounded-lg border p-2.5 transition-colors ${
                                        isBatch ? "cursor-pointer hover:border-[var(--studio-line-strong)]" : ""
                                    } ${
                                        selected
                                            ? "border-[var(--studio-primary)] bg-[var(--studio-surface-soft)]"
                                            : "border-[var(--studio-line)] opacity-60"
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        {isBatch && (
                                            <Checkbox
                                                checked={selectedIds.includes(shot.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) =>
                                                    setSelectedIds((current) =>
                                                        e.target.checked ? [...current, shot.id] : current.filter((id) => id !== shot.id)
                                                    )
                                                }
                                                aria-label={translate("comicDrama.selectShotCount", { value0: shot.shotNumber })}
                                            />
                                        )}
                                        <span className="font-mono text-xs font-semibold text-[var(--studio-ink)]">#{shot.shotNumber}</span>
                                        <span className="text-[10px] text-[var(--studio-muted)]">{productionParameterLabel(shot.shotSize || "", translate) || translate("comicDrama.shotSizeNotSet")}</span>
                                        <span className="text-[10px] text-[var(--studio-muted)]">{shot.durationSeconds}s</span>
                                        {shotPrompt ? (
                                            <span className="ml-auto text-[10px] text-[var(--studio-muted)]">{translate("comicDrama.promptVcount_1b1160", { value0: shotPrompt.versionNumber })}</span>
                                        ) : (
                                            <span className="ml-auto text-[10px] text-amber-500">{translate("comicDrama.missingFinalPrompt")}</span>
                                        )}
                                    </div>
                                    {/* 正文完整展示，过长时卡片内独立滚动；阻止冒泡，避免选中复制提示词时误切换勾选 */}
                                    <div
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-xs leading-5 text-[var(--studio-text)]"
                                    >
                                        {shotPrompt?.prompt || shot.visualDescription || translate("comicDrama.noPromptOrVisualDescription")}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 右：生成配置 */}
                <div className="flex w-[420px] shrink-0 flex-col gap-4 border-l border-[var(--studio-line)] pl-4">
                    <div>
                        <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.generationModel")}</label>
                        <div className="mt-1">
                            <ModelPicker
                                config={config}
                                capability="video"
                                value={model}
                                onChange={(value) => {
                                    setModel(value);
                                    setEstimatedCredits(null);
                                }}
                                fullWidth
                            />
                        </div>
                    </div>

                    <div className="rounded-xl border border-[var(--studio-line)] p-3">
                        <VideoSettingsPanel
                            config={{
                                ...config,
                                // 面板按 config.videoModel 决定为哪个渠道模型展示比例/清晰度/时长，必须传入弹窗里选中的模型
                                videoModel: model || config.videoModel,
                                size,
                                vquality,
                                videoSeconds,
                                videoGenerationMode,
                            }}
                            onConfigChange={handleSettingChange}
                            theme={settingsTheme}
                            showTitle={false}
                            showGenerationMode={false}
                            // 批量时各镜头分镜时长不一致，无法用一个值代表，直接隐藏时长项
                            showDuration={!isBatch}
                            className="space-y-4 px-0 py-0"
                        />
                    </div>

                    <p className="text-xs text-[var(--studio-muted)]">
                        {isBatch
                            ? translate("comicDrama.countShotsSelectedCountWithReferenceImagesForImageTo", { value0: targetShots.length, value1: shotsWithReferenceCount, value2: targetShots.length - shotsWithReferenceCount })
                            : referenceCount > 0
                                ? translate("comicDrama.useCountGeneratedImagesAsReferencesImageToVideo", { value0: referenceCount })
                                : translate("comicDrama.noReferenceImageForThisShotItWillUseText")}
                    </p>

                    <div className="mt-auto flex flex-col gap-3 border-t border-[var(--studio-line)] pt-3">
                        {constraintIssue || estimateError ? <p role="alert" className="text-xs text-[var(--studio-danger)]">{constraintIssue || estimateError}</p> : null}
                        {/* 价格放在确认按钮正上方，用色块与大号数字提高可读性 */}
                        <div className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                            <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--studio-muted)]">
                                <Coins className="size-4 text-amber-500" />
                                {translate("comicDrama.estimatedTotal")}</span>
                            {estimating ? (
                                <span className="flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                                    <Spin size="small" />
                                    {translate("comicDrama.calculating")}</span>
                            ) : estimatedCredits !== null ? (
                                <span className="text-xl font-semibold leading-none text-amber-500">
                                    {estimatedCredits}
                                    <span className="ml-1 text-xs font-normal">{translate("comicDrama.credits")}</span>
                                </span>
                            ) : (
                                <span className="text-xs text-[var(--studio-muted)]">
                                    {targetIds.length === 0 ? translate("comicDrama.noShotsSelected") : translate("comicDrama.estimateFailed")}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center justify-end">
                            <Space>
                                <Button onClick={onClose}>{translate("comicDrama.cancel")}</Button>
                                <Button
                                    type="primary"
                                    loading={generating}
                                    disabled={targetIds.length === 0 || Boolean(constraintIssue || estimateError) || estimating}
                                    icon={<Sparkles className="size-4" />}
                                    onClick={handleCreate}
                                >
                                    {isBatch ? translate("comicDrama.confirmBatchGenerationCount", { value0: targetShots.length }) : translate("comicDrama.confirmGeneration")}
                                </Button>
                            </Space>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
