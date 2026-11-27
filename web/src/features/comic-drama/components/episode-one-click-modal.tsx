"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Checkbox, Modal, Radio, Select, Spin } from "antd";
import { ChevronDown, ChevronRight, Coins, Sparkles } from "lucide-react";

import { sizeFromAspectRatio } from "@/features/generation/components/video-settings-panel";
import { ModelPicker } from "@/features/settings/components/model-picker";
import { modelOptionLabel, useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import {
    estimateComicDramaGeneration,
    readComicDramaMediaUrl,
    startComicDramaPipeline,
    type ComicDramaShotDurationLevel,
} from "@/services/api/comic-drama";
import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
import { useFinalPromptPricing } from "../hooks/use-final-prompt-pricing";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import { useVideoExportSettingsStore } from "../stores/use-video-export-settings-store";
import type { ComicDramaEpisodePipeline, ComicDramaShot } from "../types";

type EpisodeOneClickModalProps = {
    open: boolean;
    episodeId: string;
    episodeShots: ComicDramaShot[];
    onClose: () => void;
    onStarted: (pipeline: ComicDramaEpisodePipeline) => void;
};

/** 单集一键出集预算确认弹窗：自动识别缺口并跳过已完成步骤，确认后启动后台流水线。 */
export function EpisodeOneClickModal({
    open,
    episodeId,
    episodeShots,
    onClose,
    onStarted,
}: EpisodeOneClickModalProps) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const workspace = useComicDramaStore((state) => state.workspace);
    const videoExportEnabled = useVideoExportSettingsStore((state) => state.enabled);

    const [executionMode, setExecutionMode] = useState<"review" | "auto">("review");
    const [includeSplit, setIncludeSplit] = useState(true);
    const [includeAssets, setIncludeAssets] = useState(true);
    const [includePrompts, setIncludePrompts] = useState(true);
    const [includeVideos, setIncludeVideos] = useState(true);
    const [includeExport, setIncludeExport] = useState(true);

    const [showModelConfig, setShowModelConfig] = useState(false);
    const [textModel, setTextModel] = useState("");
    const [imageModel, setImageModel] = useState("");
    const [videoModel, setVideoModel] = useState("");
    const [shotDuration, setShotDuration] = useState<ComicDramaShotDurationLevel>("medium");
    const [rhythm, setRhythm] = useState("紧凑利落");
    const [videoResolution, setVideoResolution] = useState("720p");

    const [assetCredits, setAssetCredits] = useState<string | null>(null);
    const [videoCredits, setVideoCredits] = useState<string | null>(null);
    const [estimatingMedia, setEstimatingMedia] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const needsSplit = episodeShots.length === 0;

    // 统计本集缺口
    const gaps = useMemo(() => {
        const media = workspace?.media || [];
        const readyAssetVersionIds = new Set(
            media
                .filter((item) => item.targetType === "assetVersion" && item.mediaType === "image"
                    && (item.status === "completed" || item.status === "needsUpdate") && readComicDramaMediaUrl(item.resultData))
                .map((item) => item.targetId),
        );
        const missingAssetVersionIds = Array.from(
            new Set(episodeShots.flatMap((shot) => shot.assetVersionIds).filter((id) => !readyAssetVersionIds.has(id))),
        );
        const adoptedPromptShotIds = new Set(
            (workspace?.promptVersions || []).filter((item) => item.status === "adopted").map((item) => item.shotId),
        );
        const missingPromptShotIds = episodeShots.map((shot) => shot.id).filter((id) => !adoptedPromptShotIds.has(id));
        const completedVideoShotIds = new Set(
            media
                .filter((item) => item.targetType === "shot" && item.mediaType === "video"
                    && (item.status === "completed" || item.status === "needsUpdate") && readComicDramaMediaUrl(item.resultData))
                .map((item) => item.targetId),
        );
        const missingVideoShotIds = episodeShots.map((shot) => shot.id).filter((id) => !completedVideoShotIds.has(id));
        return { missingAssetVersionIds, missingPromptShotIds, missingVideoShotIds };
    }, [workspace, episodeShots]);

    const promptPricing = useFinalPromptPricing(textModel, open && Boolean(workspace));

    // 打开时初始化模型和缺口勾选
    useEffect(() => {
        if (!open) return;
        setTextModel(config.textModel || "");
        setImageModel(config.imageModel || "");
        setVideoModel(config.videoModel || "");
        setVideoResolution(config.vquality || "720p");
        setIncludeSplit(needsSplit);
        setIncludeAssets(needsSplit || gaps.missingAssetVersionIds.length > 0);
        setIncludePrompts(needsSplit || gaps.missingPromptShotIds.length > 0);
        setIncludeVideos(needsSplit || gaps.missingVideoShotIds.length > 0);
        setIncludeExport(videoExportEnabled);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const videoSize = useMemo(
        () => sizeFromAspectRatio(config, workspace?.settings.aspectRatio),
        [config, workspace?.settings.aspectRatio],
    );

    // 已有镜头时，实时向服务端估算待补资产图与待生视频的准确积分
    useEffect(() => {
        if (!open || !workspace) return;
        let cancelled = false;
        const needAssetQuote = includeAssets && !needsSplit && gaps.missingAssetVersionIds.length > 0 && Boolean(imageModel);
        const needVideoQuote = includeVideos && !needsSplit && gaps.missingVideoShotIds.length > 0 && Boolean(videoModel);
        if (!needAssetQuote && !needVideoQuote) {
            setAssetCredits(null);
            setVideoCredits(null);
            setEstimatingMedia(false);
            return;
        }
        setEstimatingMedia(true);
        Promise.all([
            needAssetQuote
                ? estimateComicDramaGeneration({
                    projectId: workspace.projectId,
                    targetType: "assetVersion",
                    targetIds: gaps.missingAssetVersionIds,
                    model: imageModel,
                    settings: { mediaType: "image", size: "1:1" },
                }).then((res) => String(res.estimatedCredits)).catch(() => null)
                : Promise.resolve(null),
            needVideoQuote
                ? estimateComicDramaGeneration({
                    projectId: workspace.projectId,
                    targetType: "shot",
                    targetIds: gaps.missingVideoShotIds,
                    model: videoModel,
                    settings: { mediaType: "video", size: videoSize, resolution: videoResolution, usePlannedShotDuration: true },
                }).then((res) => String(res.estimatedCredits)).catch(() => null)
                : Promise.resolve(null),
        ]).then(([aCredits, vCredits]) => {
            if (!cancelled) {
                setAssetCredits(aCredits);
                setVideoCredits(vCredits);
            }
        }).finally(() => {
            if (!cancelled) setEstimatingMedia(false);
        });
        return () => { cancelled = true; };
    }, [open, workspace, includeAssets, includeVideos, needsSplit, gaps, imageModel, videoModel, videoSize, videoResolution]);

    const promptTotalCredits = useMemo(() => {
        if (!includePrompts || needsSplit || gaps.missingPromptShotIds.length === 0 || !promptPricing.ready) return null;
        return creditAmount(promptPricing.data!.unitPrice!).mul(gaps.missingPromptShotIds.length).toFixed();
    }, [includePrompts, needsSplit, gaps.missingPromptShotIds.length, promptPricing]);

    const knownTotalCredits = useMemo(() => {
        let sum = creditAmount(0);
        if (promptTotalCredits) sum = sum.add(creditAmount(promptTotalCredits));
        if (assetCredits) sum = sum.add(creditAmount(assetCredits));
        if (videoCredits) sum = sum.add(creditAmount(videoCredits));
        return sum.toFixed();
    }, [promptTotalCredits, assetCredits, videoCredits]);

    const episodeLabel = useMemo(() => {
        if (!workspace || !episodeId || episodeId === "all") return "当前全部镜头";
        const ep = workspace.scriptProject.episodes.find((item) => item.id === episodeId);
        return ep ? `第${ep.episodeNumber}集《${ep.title || "未命名"}》` : "当前分集";
    }, [workspace, episodeId]);

    const handleStart = async () => {
        if (!workspace) return;
        if (!includeSplit && !includeAssets && !includePrompts && !includeVideos && !includeExport) {
            message.warning("请至少勾选一个需要执行的步骤");
            return;
        }
        if ((includeSplit || includePrompts) && !textModel) {
            message.warning("请选择用于拆镜头与合成提示词的文本模型");
            setShowModelConfig(true);
            return;
        }
        if (includeAssets && !imageModel) {
            message.warning("请选择用于补齐资产图的生图模型");
            setShowModelConfig(true);
            return;
        }
        if (includeVideos && !videoModel) {
            message.warning("请选择用于生成镜头视频的视频模型");
            setShowModelConfig(true);
            return;
        }
        setSubmitting(true);
        try {
            const pipeline = await startComicDramaPipeline({
                projectId: workspace.projectId,
                episodeId: episodeId === "all" ? null : episodeId,
                executionMode,
                includeSplit,
                includeAssets,
                includePrompts,
                includeVideos,
                includeExport: videoExportEnabled && includeExport,
                textModel,
                imageModel,
                videoModel,
                shotDuration,
                rhythm,
                videoSize,
                videoResolution,
                expectedPricingRevision: promptPricing.data?.revision,
                confirmed: true,
            });
            message.success("单集一键出集流水线已启动");
            onStarted(pipeline);
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "启动一键出集失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            title={
                <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-[var(--studio-action)]" />
                    <span>一键出集 · {episodeLabel}</span>
                </div>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={600}
            mask={{ closable: true }}
        >
            <div className="space-y-4 py-2">
                <p className="text-xs text-[var(--studio-muted)]">
                    系统已自动扫描本集缺失项，已完成步骤会自动跳过，不重复扣费。执行过程中可刷新页面，后台流水线会持续推进。
                </p>

                {/* 步骤勾选清单 */}
                <div className="space-y-2">
                    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-3">
                        <div className="flex items-start gap-2.5">
                            <Checkbox checked={includeSplit} disabled={!needsSplit} onChange={(e) => setIncludeSplit(e.target.checked)} />
                            <div>
                                <div className="text-xs font-semibold text-[var(--studio-ink)]">1. AI 拆分本集镜头</div>
                                <div className="mt-0.5 text-xs text-[var(--studio-muted)]">
                                    {needsSplit ? "本集尚无镜头，将按剧本自动拆解并写入正式分镜" : `已有 ${episodeShots.length} 个镜头，自动跳过`}
                                </div>
                            </div>
                        </div>
                        <span className="shrink-0 text-xs text-[var(--studio-muted)]">{needsSplit ? "按文本模型计费" : "已跳过"}</span>
                    </label>

                    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-3">
                        <div className="flex items-start gap-2.5">
                            <Checkbox
                                checked={includeAssets}
                                disabled={!needsSplit && gaps.missingAssetVersionIds.length === 0}
                                onChange={(e) => setIncludeAssets(e.target.checked)}
                            />
                            <div>
                                <div className="text-xs font-semibold text-[var(--studio-ink)]">2. 补齐本集缺失资产设定图</div>
                                <div className="mt-0.5 text-xs text-[var(--studio-muted)]">
                                    {needsSplit
                                        ? "拆镜头完成后自动为新关联的缺失资产补图"
                                        : gaps.missingAssetVersionIds.length > 0
                                            ? `待补 ${gaps.missingAssetVersionIds.length} 张资产设定图，供后续图生视频参考`
                                            : "本集关联资产图已全部就绪，自动跳过"}
                                </div>
                            </div>
                        </div>
                        <span className="shrink-0 font-mono text-xs text-[var(--studio-muted)] tabular-nums">
                            {assetCredits ? `${creditText(assetCredits)} 积分` : needsSplit ? "拆完计费" : "—"}
                        </span>
                    </label>

                    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-3">
                        <div className="flex items-start gap-2.5">
                            <Checkbox
                                checked={includePrompts}
                                disabled={!needsSplit && gaps.missingPromptShotIds.length === 0}
                                onChange={(e) => setIncludePrompts(e.target.checked)}
                            />
                            <div>
                                <div className="text-xs font-semibold text-[var(--studio-ink)]">3. 批量合成最终视频提示词</div>
                                <div className="mt-0.5 text-xs text-[var(--studio-muted)]">
                                    {needsSplit
                                        ? "为拆出的全部镜头并发合成并采用最终提示词"
                                        : gaps.missingPromptShotIds.length > 0
                                            ? `待合成 ${gaps.missingPromptShotIds.length} 个镜头的最终视频提示词`
                                            : "全部镜头已有采用提示词，自动跳过"}
                                </div>
                            </div>
                        </div>
                        <span className="shrink-0 font-mono text-xs text-[var(--studio-muted)] tabular-nums">
                            {promptTotalCredits ? `${creditText(promptTotalCredits)} 积分` : needsSplit ? "按镜计费" : "—"}
                        </span>
                    </label>

                    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-3">
                        <div className="flex items-start gap-2.5">
                            <Checkbox
                                checked={includeVideos}
                                disabled={!needsSplit && gaps.missingVideoShotIds.length === 0}
                                onChange={(e) => setIncludeVideos(e.target.checked)}
                            />
                            <div>
                                <div className="text-xs font-semibold text-[var(--studio-ink)]">4. 批量生成镜头视频</div>
                                <div className="mt-0.5 text-xs text-[var(--studio-muted)]">
                                    {needsSplit
                                        ? "按每个镜头的规划时长自动挂载参考图生成视频"
                                        : gaps.missingVideoShotIds.length > 0
                                            ? `待生成 ${gaps.missingVideoShotIds.length} 个未完成/失败镜头的视频`
                                            : "本集镜头视频已全部完成，自动跳过"}
                                </div>
                            </div>
                        </div>
                        <span className="shrink-0 font-mono text-xs text-[var(--studio-muted)] tabular-nums">
                            {videoCredits ? `${creditText(videoCredits)} 积分` : needsSplit ? "按镜计费" : "—"}
                        </span>
                    </label>

                    {videoExportEnabled ? (
                        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-3">
                            <div className="flex items-start gap-2.5">
                                <Checkbox checked={includeExport} onChange={(e) => setIncludeExport(e.target.checked)} />
                                <div>
                                    <div className="text-xs font-semibold text-[var(--studio-ink)]">5. 自动拼接并导出本集 MP4</div>
                                    <div className="mt-0.5 text-xs text-[var(--studio-muted)]">全部镜头视频完成后自动合成字幕与音频轨输出成片</div>
                                </div>
                            </div>
                            <span className="shrink-0 text-xs text-[var(--studio-muted)]">免费</span>
                        </label>
                    ) : null}
                </div>

                {/* 执行策略 */}
                <div className="space-y-2 rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)] p-3">
                    <div className="text-xs font-semibold text-[var(--studio-ink)]">执行策略</div>
                    <Radio.Group
                        value={executionMode}
                        onChange={(e) => setExecutionMode(e.target.value)}
                        className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                        <Radio value="review" className="!m-0 rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] p-2.5">
                            <div className="text-xs font-semibold text-[var(--studio-ink)]">关键节点停顿（推荐）</div>
                            <div className="text-[11px] text-[var(--studio-muted)]">拆镜头与补资产图后暂停确认，再消耗视频积分</div>
                        </Radio>
                        <Radio value="auto" className="!m-0 rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface)] p-2.5">
                            <div className="text-xs font-semibold text-[var(--studio-ink)]">全自动直出（省心）</div>
                            <div className="text-[11px] text-[var(--studio-muted)]">一路自动跑完所有勾选步骤直到导出成片</div>
                        </Radio>
                    </Radio.Group>
                </div>

                {/* 可折叠模型与参数配置 */}
                <div className="rounded-lg border border-[var(--studio-line)] bg-[var(--studio-page)]">
                    <button
                        type="button"
                        onClick={() => setShowModelConfig((prev) => !prev)}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-xs! text-[var(--studio-ink)]!"
                    >
                        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium">
                            {showModelConfig ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                            <span>模型与拆镜参数预设</span>
                        </span>
                        <span
                            className="min-w-0 truncate text-right text-[11px] text-[var(--studio-muted)]"
                            title={`${textModel ? modelOptionLabel(config, textModel) : "未选文本"} · ${imageModel ? modelOptionLabel(config, imageModel) : "未选生图"} · ${videoModel ? modelOptionLabel(config, videoModel) : "未选视频"}`}
                        >
                            {textModel ? modelOptionLabel(config, textModel) : "未选文本"} · {imageModel ? modelOptionLabel(config, imageModel) : "未选生图"} · {videoModel ? modelOptionLabel(config, videoModel) : "未选视频"}
                        </span>
                    </button>
                    {showModelConfig ? (
                        <div className="space-y-3 border-t border-[var(--studio-line)] p-3">
                            <div className="grid grid-cols-1 gap-2.5">
                                <div>
                                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">文本模型（拆镜/提示词）</label>
                                    <ModelPicker config={config} capability="text" value={textModel} onChange={setTextModel} fullWidth />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">生图模型（资产图）</label>
                                    <ModelPicker config={config} capability="image" value={imageModel} onChange={setImageModel} fullWidth />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">视频模型（镜头视频）</label>
                                    <ModelPicker config={config} capability="video" value={videoModel} onChange={setVideoModel} fullWidth />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">叙事节奏</label>
                                    <Select
                                        className="w-full"
                                        value={rhythm}
                                        onChange={setRhythm}
                                        options={[
                                            { value: "紧凑利落", label: "紧凑利落" },
                                            { value: "高潮反转", label: "高潮反转" },
                                            { value: "舒缓写意", label: "舒缓写意" },
                                            { value: "激烈打斗", label: "激烈打斗" },
                                        ]}
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">单镜时长档位</label>
                                    <Select
                                        className="w-full"
                                        value={shotDuration}
                                        onChange={setShotDuration}
                                        options={[
                                            { value: "short", label: "简短 (~5s)" },
                                            { value: "medium", label: "中等 (5~8s)" },
                                            { value: "long", label: "较长 (10s+)" },
                                        ]}
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">视频清晰度</label>
                                    <Select
                                        className="w-full"
                                        value={videoResolution}
                                        onChange={setVideoResolution}
                                        options={[
                                            { value: "720p", label: "720p" },
                                            { value: "1080p", label: "1080p" },
                                        ]}
                                    />
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>

                {needsSplit && (includeAssets || includeVideos) ? (
                    <Alert
                        type="info"
                        showIcon
                        title="本集尚未拆镜头，资产图与视频的具体数量将在拆镜完成后按实际结果计费。"
                    />
                ) : null}

                {/* 底部预算汇总与提交 */}
                <div className="flex items-center justify-between border-t border-[var(--studio-line)] pt-3">
                    <div className="flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                        <Coins className="size-4 text-[var(--studio-warning)]" />
                        <span>当前可预估消耗：</span>
                        {estimatingMedia ? (
                            <Spin size="small" />
                        ) : (
                            <strong className="font-mono text-sm text-[var(--studio-ink)] tabular-nums">
                                {creditText(knownTotalCredits)} 积分
                            </strong>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" loading={submitting} icon={<Sparkles className="size-4" />} onClick={() => void handleStart()}>
                            确认并开始出集
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
