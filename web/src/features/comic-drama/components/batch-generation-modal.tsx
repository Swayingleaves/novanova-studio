"use client";

import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Modal, Progress, Radio, Select, Space, Tabs, Tag } from "antd";
import { CheckCircle2, Clapperboard, Film, Layers, Play, Sparkles } from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaBatchTask } from "../types";

type BatchGenerationModalProps = {
    open: boolean;
    onClose: () => void;
};

/** P1 批量生产计划与进度监控弹窗。 */
export function BatchGenerationModal({ open, onClose }: BatchGenerationModalProps) {
    const translate = useTranslation();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const workspace = useComicDramaStore((state) => state.workspace);
    const createBatchTask = useComicDramaStore((state) => state.createBatchTask);

    const [activeTab, setActiveTab] = useState<string>("create");
    const [scopeType, setScopeType] = useState<string>("uncompleted");
    const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>("");
    const [taskType, setTaskType] = useState<"image" | "video">("image");
    const [model, setModel] = useState<string>("");
    const [aspectRatio, setAspectRatio] = useState<string>(workspace?.settings.aspectRatio || "16:9");
    const [submitting, setSubmitting] = useState(false);

    // 打开弹窗时跟随项目生产设置的画面方向，避免每次都手动重选
    useEffect(() => {
        if (!open) return;
        setAspectRatio(workspace?.settings.aspectRatio || "16:9");
    }, [open, workspace?.settings.aspectRatio]);

    const shots = workspace?.shots || [];
    const episodes = workspace?.scriptProject?.episodes || [];
    const batchTasks = workspace?.batchTasks || [];

    // Target shots based on scope
    const targetShots = useMemo(() => {
        if (scopeType === "all") return shots;
        if (scopeType === "episode" && selectedEpisodeId) {
            return shots.filter((s) => s.sourceEpisodeId === selectedEpisodeId);
        }
        // Default: uncompleted shots only
        return shots.filter((s) => s.productionStatus !== "completed");
    }, [shots, scopeType, selectedEpisodeId]);

    const targetIds = useMemo(() => targetShots.map((s) => s.id), [targetShots]);

    const handleCreateBatch = async () => {
        if (targetIds.length === 0) {
            message.warning(translate("comicDrama.noShotsInThisRangeNeedGeneration"));
            return;
        }
        if (!model) {
            message.warning(translate("comicDrama.selectAGenerationModel"));
            return;
        }

        setSubmitting(true);
        try {
            await createBatchTask({
                scope: scopeType,
                targetIds,
                taskType,
                model,
                settings: {
                    mediaType: taskType,
                    // 后端与各家适配器读 size 而不是 aspectRatio
                    size: aspectRatio,
                },
            });
            message.success(translate("comicDrama.batchTaskCreatedForCountShots", { value0: targetIds.length }));
            setActiveTab("monitor");
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            title={
                <div className="flex items-center gap-2">
                    <Layers className="size-5 text-[var(--studio-primary)]" />
                    <span>{translate("comicDrama.batchProduction")}</span>
                </div>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={640}
        >
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    {
                        key: "create",
                        label: translate("comicDrama.startBatchGeneration"),
                        children: (
                            <div className="flex flex-col gap-4 py-2">
                                <Alert
                                    type="info"
                                    showIcon
                                    title={translate("comicDrama.batchTasksGenerateMediaInShotOrder")}
                                    description={translate("comicDrama.generationUsesEachShotSAdoptedPromptCompletedShotsAre")}
                                />

                                <div>
                                    <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.generationRange")}</label>
                                    <Select
                                        className="mt-1 w-full"
                                        value={scopeType}
                                        onChange={(val) => {
                                            setScopeType(val);
                                            if (val === "episode" && !selectedEpisodeId) {
                                                setSelectedEpisodeId(episodes[0]?.id || "");
                                            }
                                        }}
                                        options={[
                                            { value: "uncompleted", label: translate("comicDrama.unfinishedShotsCount", { value0: shots.filter((s) => s.productionStatus !== "completed").length }) },
                                            { value: "all", label: translate("comicDrama.allShotsCount", { value0: shots.length }) },
                                            { value: "episode", label: translate("comicDrama.generateByEpisode") },
                                        ]}
                                    />
                                </div>

                                {scopeType === "episode" && (
                                    <div>
                                        <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.selectEpisode")}</label>
                                        <Select
                                            className="mt-1 w-full"
                                            value={selectedEpisodeId}
                                            onChange={setSelectedEpisodeId}
                                            options={episodes.map((ep) => ({
                                                value: ep.id,
                                                label: translate("comicDrama.episodeCountCount", { value0: ep.episodeNumber, value1: ep.title || translate("comicDrama.untitled") }),
                                            }))}
                                        />
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.mediaType")}</label>
                                        <Select
                                            className="mt-1 w-full"
                                            value={taskType}
                                            onChange={(val: "image" | "video") => {
                                                setTaskType(val);
                                                setModel(val === "video" ? config.videoModel || "" : config.imageModel || "");
                                            }}
                                            options={[
                                                { value: "image", label: translate("comicDrama.storyboardImage") },
                                                { value: "video", label: translate("comicDrama.shotVideo") },
                                            ]}
                                        />
                                    </div>

                                    <div>
                                        <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.aspectRatio")}</label>
                                        <Select
                                            className="mt-1 w-full"
                                            value={aspectRatio}
                                            onChange={setAspectRatio}
                                            options={[
                                                { value: "9:16", label: translate("comicDrama.message916Portrait") },
                                                { value: "16:9", label: translate("comicDrama.message169Landscape") },
                                                { value: "1:1", label: translate("comicDrama.message11Square") },
                                            ]}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.generationModel")}</label>
                                    <div className="mt-1">
                                        <ModelPicker
                                            config={config}
                                            capability={taskType === "video" ? "video" : "image"}
                                            value={model}
                                            onChange={setModel}
                                            fullWidth
                                        />
                                    </div>
                                </div>

                                <div className="mt-3 flex items-center justify-between border-t border-[var(--studio-line)] pt-3">
                                    <span className="text-xs text-[var(--studio-muted)]">
                                        {translate("comicDrama.targets")}<strong className="text-[var(--studio-ink)]">{targetIds.length}</strong> {translate("comicDrama.shots")}</span>
                                    <Button
                                        type="primary"
                                        loading={submitting}
                                        disabled={targetIds.length === 0}
                                        icon={<Sparkles className="size-4" />}
                                        onClick={handleCreateBatch}
                                    >
                                        {translate("comicDrama.startBatchGeneration_77cd21")}</Button>
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "monitor",
                        label: translate("comicDrama.progressCount", { value0: batchTasks.length }),
                        children: (
                            <div className="flex flex-col gap-3 py-2">
                                {batchTasks.length === 0 ? (
                                    <div className="py-8 text-center text-xs text-[var(--studio-muted)]">
                                        {translate("comicDrama.noBatchProductionTasksYet")}</div>
                                ) : (
                                    batchTasks.map((task) => {
                                        const percent =
                                            task.totalCount > 0
                                                ? Math.round((task.completedCount / task.totalCount) * 100)
                                                : 0;

                                        return (
                                            <div
                                                key={task.id}
                                                className="rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 shadow-sm"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Tag color={task.batchType === "video" ? "purple" : "blue"}>
                                                            {task.batchType === "video" ? translate("comicDrama.videoBatch") : translate("comicDrama.imageBatch")}
                                                        </Tag>
                                                        <span className="font-semibold text-[var(--studio-ink)]">{translate("comicDrama.countShots_cfb6a3", { value0: task.totalCount })}</span>
                                                    </div>
                                                    <Tag
                                                        color={
                                                            task.status === "completed"
                                                                ? "success"
                                                                : task.status === "failed"
                                                                  ? "error"
                                                                  : "processing"
                                                        }
                                                    >
                                                        {task.status === "completed"
                                                            ? translate("comicDrama.allCompleted")
                                                            : task.status === "failed"
                                                              ? translate("comicDrama.failed")
                                                              : translate("comicDrama.queued")}
                                                    </Tag>
                                                </div>

                                                <div className="mt-3">
                                                    <Progress percent={percent} size="small" />
                                                </div>

                                                <div className="mt-2 flex items-center justify-between text-xs text-[var(--studio-muted)]">
                                                    <span>{translate("comicDrama.completedCountQueuedCountFailedCount_991ddb", { value0: task.completedCount, value1: task.queuedCount, value2: task.failedCount })}</span>
                                                    <span>{translate("comicDrama.estimatedCostCountCredits_715a6a", { value0: task.estimatedCredits })}</span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        ),
                    },
                ]}
            />
        </Modal>
    );
}
