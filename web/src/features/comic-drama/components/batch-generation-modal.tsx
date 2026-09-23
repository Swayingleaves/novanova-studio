"use client";

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
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const workspace = useComicDramaStore((state) => state.workspace);
    const createBatchTask = useComicDramaStore((state) => state.createBatchTask);

    const [activeTab, setActiveTab] = useState<string>("create");
    const [scopeType, setScopeType] = useState<string>("uncompleted");
    const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>("");
    const [taskType, setTaskType] = useState<string>("image");
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
            message.warning("所选范围内没有需要生成的镜头");
            return;
        }
        if (!model) {
            message.warning("请选择生成模型");
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
            message.success(`已创建包含 ${targetIds.length} 个镜头的批量生成任务`);
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
                    <span>批量生产管理 (Batch Production)</span>
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
                        label: "发起批量生成",
                        children: (
                            <div className="flex flex-col gap-4 py-2">
                                <Alert
                                    type="info"
                                    showIcon
                                    title="批量任务将按镜头顺序自动生成素材"
                                    description="系统将基于各个镜头已采用的提示词进行生成。已完成的镜头不会被重复处理，确保积分安全。"
                                />

                                <div>
                                    <label className="text-xs font-medium text-[var(--studio-muted)]">生成范围</label>
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
                                            { value: "uncompleted", label: `未完成镜头 (${shots.filter((s) => s.productionStatus !== "completed").length} 个)` },
                                            { value: "all", label: `全剧全部镜头 (${shots.length} 个)` },
                                            { value: "episode", label: "按指定分集批量生成" },
                                        ]}
                                    />
                                </div>

                                {scopeType === "episode" && (
                                    <div>
                                        <label className="text-xs font-medium text-[var(--studio-muted)]">选择分集</label>
                                        <Select
                                            className="mt-1 w-full"
                                            value={selectedEpisodeId}
                                            onChange={setSelectedEpisodeId}
                                            options={episodes.map((ep) => ({
                                                value: ep.id,
                                                label: `第${ep.episodeNumber}集：${ep.title || "无标题"}`,
                                            }))}
                                        />
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-[var(--studio-muted)]">媒体类型</label>
                                        <Select
                                            className="mt-1 w-full"
                                            value={taskType}
                                            onChange={(val: "image" | "video") => {
                                                setTaskType(val);
                                                setModel(val === "video" ? config.videoModel || "" : config.imageModel || "");
                                            }}
                                            options={[
                                                { value: "image", label: "分镜图片 (Image)" },
                                                { value: "video", label: "镜头视频 (Video)" },
                                            ]}
                                        />
                                    </div>

                                    <div>
                                        <label className="text-xs font-medium text-[var(--studio-muted)]">画面比例</label>
                                        <Select
                                            className="mt-1 w-full"
                                            value={aspectRatio}
                                            onChange={setAspectRatio}
                                            options={[
                                                { value: "9:16", label: "9:16 (竖屏)" },
                                                { value: "16:9", label: "16:9 (横屏)" },
                                                { value: "1:1", label: "1:1 (正方)" },
                                            ]}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-medium text-[var(--studio-muted)]">生成模型</label>
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
                                        目标任务数：<strong className="text-[var(--studio-ink)]">{targetIds.length}</strong> 个镜头
                                    </span>
                                    <Button
                                        type="primary"
                                        loading={submitting}
                                        disabled={targetIds.length === 0}
                                        icon={<Sparkles className="size-4" />}
                                        onClick={handleCreateBatch}
                                    >
                                        开始批量生成
                                    </Button>
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "monitor",
                        label: `进度监控 (${batchTasks.length})`,
                        children: (
                            <div className="flex flex-col gap-3 py-2">
                                {batchTasks.length === 0 ? (
                                    <div className="py-8 text-center text-xs text-[var(--studio-muted)]">
                                        暂无批量生产任务
                                    </div>
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
                                                            {task.batchType === "video" ? "视频批量" : "图片批量"}
                                                        </Tag>
                                                        <span className="font-semibold text-[var(--studio-ink)]">
                                                            共 {task.totalCount} 个镜头
                                                        </span>
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
                                                            ? "已全部完成"
                                                            : task.status === "failed"
                                                              ? "执行失败"
                                                              : "排队处理中"}
                                                    </Tag>
                                                </div>

                                                <div className="mt-3">
                                                    <Progress percent={percent} size="small" />
                                                </div>

                                                <div className="mt-2 flex items-center justify-between text-xs text-[var(--studio-muted)]">
                                                    <span>
                                                        已完成: {task.completedCount} · 排队: {task.queuedCount} · 失败: {task.failedCount}
                                                    </span>
                                                    <span>
                                                        消耗预估: {task.estimatedCredits} 积分
                                                    </span>
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
