"use client";

import { useEffect, useState } from "react";
import { App, Button, Input, InputNumber, Select, Tag } from "antd";
import { AtSign, Maximize2, Play, Save, Sparkles, Trash2, Video } from "lucide-react";

import { readComicDramaMediaUrl } from "@/services/api/comic-drama";
import { readPromptBody } from "../lib/prompt-references";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaMediaResult, ComicDramaPromptVersion, ComicDramaShot } from "../types";

const SHOT_SIZE_OPTIONS = [
    { value: "远景", label: "远景" },
    { value: "全景", label: "全景" },
    { value: "中景", label: "中景" },
    { value: "近景", label: "近景" },
    { value: "特写", label: "特写" },
    { value: "大特写", label: "大特写" },
];

type UnifiedShotInspectorProps = {
    shot: ComicDramaShot | null;
    media?: ComicDramaMediaResult;
    adoptedPrompt?: ComicDramaPromptVersion;
    assetImageByVersionId: Map<string, string>;
    composingPrompt: boolean;
    onOpenBigPreview: () => void;
    onMentionInAgent: (shotId: string) => void;
    onComposePrompt: (shot: ComicDramaShot) => void;
    onGenerateVideo: (shotId: string) => void;
    onGenerateShotAssets: (shot: ComicDramaShot) => void;
    onDeleteShot: (shot: ComicDramaShot) => void;
};

/** 右侧单镜精调与小窗预览面板（无 3D 翻转，边看画面边改参数与提示词）。 */
export function UnifiedShotInspector({
    shot,
    media,
    adoptedPrompt,
    assetImageByVersionId,
    composingPrompt,
    onOpenBigPreview,
    onMentionInAgent,
    onComposePrompt,
    onGenerateVideo,
    onGenerateShotAssets,
    onDeleteShot,
}: UnifiedShotInspectorProps) {
    const { message } = App.useApp();
    const saveShot = useComicDramaStore((state) => state.saveShot);
    const savePrompt = useComicDramaStore((state) => state.savePrompt);
    const focusAssetVersion = useComicDramaStore((state) => state.focusAssetVersion);

    const [shotSize, setShotSize] = useState("中景");
    const [cameraMovement, setCameraMovement] = useState("固定镜头");
    const [durationSeconds, setDurationSeconds] = useState<number>(5);
    const [visualDescription, setVisualDescription] = useState("");
    const [dialogueVoiceover, setDialogueVoiceover] = useState("");
    const [lightingAtmosphere, setLightingAtmosphere] = useState("");
    const [soundDescription, setSoundDescription] = useState("");
    const [promptDraft, setPromptDraft] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!shot) return;
        setShotSize(shot.shotSize || "中景");
        setCameraMovement(shot.cameraMovement || "固定镜头");
        setDurationSeconds(Number(shot.durationSeconds || 5));
        setVisualDescription(shot.visualDescription || "");
        setDialogueVoiceover(shot.dialogueVoiceover || "");
        setLightingAtmosphere(shot.lightingAtmosphere || "");
        setSoundDescription(shot.soundDescription || "");
        setPromptDraft(readPromptBody(adoptedPrompt || null));
    }, [shot, adoptedPrompt]);

    if (!shot) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-[var(--studio-muted)]">
                选中左侧任意镜头，即可在此实时预览画面、微调参数与最终提示词。
            </div>
        );
    }

    const mediaUrl = media ? readComicDramaMediaUrl(media.resultData) : "";
    const isVideo = media?.mediaType === "video" && Boolean(mediaUrl);

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveShot({
                id: shot.id,
                sourceEpisodeId: shot.sourceEpisodeId,
                sourceSceneId: shot.sourceSceneId,
                sourceScriptExcerpt: shot.sourceScriptExcerpt,
                shotNumber: shot.shotNumber,
                sortOrder: shot.sortOrder,
                durationSeconds: Number(durationSeconds || 3),
                shotSize,
                composition: shot.composition,
                visualDescription,
                actionDescription: shot.actionDescription,
                cameraMovement,
                lightingAtmosphere,
                dialogueVoiceover,
                soundDescription,
                styleOverride: shot.styleOverride,
                productionStatus: shot.productionStatus,
                assetVersionIds: shot.assetVersionIds,
                revision: shot.revision,
            });
            const trimmedPrompt = promptDraft.trim();
            if (trimmedPrompt && trimmedPrompt !== readPromptBody(adoptedPrompt || null)) {
                await savePrompt(shot.id, trimmedPrompt, undefined, adoptedPrompt?.id);
            }
            message.success(`镜头 #${shot.shotNumber} 修改已保存`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存镜头失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col">
            {/* 小窗视频预览 */}
            <div className="border-b border-[var(--studio-line)] p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-[var(--studio-ink)]">#{String(shot.shotNumber).padStart(2, "0")}</span>
                        <Tag className="!m-0 text-[11px]">{shot.shotSize || "中景"}</Tag>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onMentionInAgent(shot.id)}
                            className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-xs! text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                        >
                            <AtSign className="size-3" />
                            <span>问 AI</span>
                        </button>
                        <button
                            type="button"
                            onClick={onOpenBigPreview}
                            className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-xs! text-[var(--studio-muted)]! hover:bg-[var(--studio-surface-hover)] hover:text-[var(--studio-ink)]!"
                        >
                            <Maximize2 className="size-3" />
                            <span>大屏</span>
                        </button>
                    </div>
                </div>

                <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-[var(--studio-line)] bg-black">
                    {isVideo ? (
                        <video src={mediaUrl} controls playsInline className="h-full w-full object-contain" />
                    ) : mediaUrl ? (
                        <img src={mediaUrl} alt={`镜头 #${shot.shotNumber}`} className="h-full w-full object-contain" />
                    ) : (
                        <div className="flex flex-col items-center gap-2 p-4 text-center">
                            <Video className="size-6 text-[var(--studio-muted)]" />
                            <span className="text-xs text-[var(--studio-muted)]">
                                {media?.status === "processing" || media?.status === "queued"
                                    ? "视频正在渲染中…"
                                    : media?.status === "failed"
                                        ? `生成失败：${media.failureReason || "请重试"}`
                                        : "当前镜头尚未生成视频"}
                            </span>
                            <Button size="small" type="primary" icon={<Play className="size-3" />} onClick={() => onGenerateVideo(shot.id)}>
                                生成本镜视频
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* 镜头参数与最终提示词原地编辑 */}
            <div className="space-y-3 p-3.5">
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="mb-1 block text-xs text-[var(--studio-muted)]">景别</label>
                        <Select size="small" className="w-full" value={shotSize} onChange={setShotSize} options={SHOT_SIZE_OPTIONS} />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs text-[var(--studio-muted)]">时长(s)</label>
                        <InputNumber size="small" min={0.5} max={120} step={0.5} className="w-full!" value={durationSeconds} onChange={(v) => setDurationSeconds(Number(v || 3))} />
                    </div>
                </div>

                <div>
                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">运镜与调度</label>
                    <Input.TextArea
                        rows={2}
                        value={cameraMovement}
                        onChange={(e) => setCameraMovement(e.target.value)}
                        placeholder="如：缓慢推进、横向摇摄，或完整的运镜调度描述…"
                    />
                </div>

                <div>
                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">画面构图与视觉描述</label>
                    <Input.TextArea rows={3} value={visualDescription} onChange={(e) => setVisualDescription(e.target.value)} placeholder="描述主体、构图、动作与环境…" />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-xs text-[var(--studio-muted)]">对白 / 旁白</label>
                        <Input size="small" value={dialogueVoiceover} onChange={(e) => setDialogueVoiceover(e.target.value)} placeholder="无台词/纯画面" />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs text-[var(--studio-muted)]">光线与氛围</label>
                        <Input size="small" value={lightingAtmosphere} onChange={(e) => setLightingAtmosphere(e.target.value)} placeholder="如：霓虹雨夜、暖阳斜照" />
                    </div>
                </div>

                <div>
                    <label className="mb-1 block text-xs text-[var(--studio-muted)]">音效描述</label>
                    <Input size="small" value={soundDescription} onChange={(e) => setSoundDescription(e.target.value)} placeholder="如：急促雨声、金属碰撞" />
                </div>

                <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="block text-xs text-[var(--studio-muted)]">
                            最终视频提示词 {adoptedPrompt ? `(v${adoptedPrompt.versionNumber})` : "(未生成)"}
                        </label>
                        <Button
                            size="small"
                            type="text"
                            icon={<Sparkles className="size-3" />}
                            loading={composingPrompt}
                            onClick={() => onComposePrompt(shot)}
                        >
                            AI 合成
                        </Button>
                    </div>
                    <Input.TextArea
                        rows={4}
                        value={promptDraft}
                        onChange={(e) => setPromptDraft(e.target.value)}
                        placeholder="保存时将自动采用为最新提示词，视频生成直接读取这里的内容…"
                    />
                </div>

                {/* 关联视觉资产 */}
                <div>
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs text-[var(--studio-muted)]">本镜参考资产 ({shot.assetVersionIds.length})</span>
                        {shot.assetVersionIds.length > 0 ? (
                            <button
                                type="button"
                                onClick={() => onGenerateShotAssets(shot)}
                                className="cursor-pointer text-xs! text-[var(--studio-action)]! hover:underline"
                            >
                                补齐本镜缺图
                            </button>
                        ) : null}
                    </div>
                    {shot.assetVersionIds.length === 0 ? (
                        <div className="rounded border border-dashed border-[var(--studio-line)] px-2.5 py-2 text-xs text-[var(--studio-faint)]">
                            暂无绑定资产，生视频时将走文生视频
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {shot.assetVersionIds.map((versionId) => {
                                const imgUrl = assetImageByVersionId.get(versionId);
                                return (
                                    <button
                                        key={versionId}
                                        type="button"
                                        onClick={() => focusAssetVersion(versionId)}
                                        className="flex items-center gap-1.5 rounded-md border border-[var(--studio-line)] bg-[var(--studio-surface-raised)] p-1 pr-2 text-xs! text-[var(--studio-ink)]! hover:border-[var(--studio-action)] cursor-pointer"
                                        title="点击在资产库中查看"
                                    >
                                        {imgUrl ? (
                                            <img src={imgUrl} alt="" className="size-7 rounded object-cover" />
                                        ) : (
                                            <span className="flex size-7 items-center justify-center rounded border border-dashed border-[var(--studio-warning)] text-[10px] text-[var(--studio-warning)]">
                                                缺图
                                            </span>
                                        )}
                                        <span className="max-w-20 truncate">{versionId.split("_")[1] || versionId}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* 底部主操作 */}
                <div className="flex items-center gap-2 border-t border-[var(--studio-line)] pt-3">
                    <Button icon={<Save className="size-3.5" />} loading={saving} onClick={() => void handleSave()}>
                        保存修改
                    </Button>
                    <Button type="primary" className="flex-1" icon={<Sparkles className="size-3.5" />} onClick={() => onGenerateVideo(shot.id)}>
                        {isVideo ? "重生成视频" : "生成视频"}
                    </Button>
                    <Button danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => onDeleteShot(shot)} title="删除该镜头" />
                </div>
            </div>
        </div>
    );
}
