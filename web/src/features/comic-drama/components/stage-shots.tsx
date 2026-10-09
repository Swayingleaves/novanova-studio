"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Alert,
    App,
    Button,
    Card,
    Checkbox,
    Drawer,
    Empty,
    Form,
    Image,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Select,
    Space,
    Table,
    Tag,
} from "antd";
import {
    ArrowDown,
    ArrowUp,
    Bot,
    ChevronDown,
    Clapperboard,
    Edit,
    Image as ImageIcon,
    Plus,
    RotateCcw,
    Sparkles,
    Trash2,
} from "lucide-react";

import { ModelPicker } from "@/features/settings/components/model-picker";
import { useEffectiveConfig } from "@/features/settings/stores/use-config-store";
import { readComicDramaMediaUrl } from "@/services/api/comic-drama";
import { usePendingImpactTargets } from "../hooks/use-pending-impact-targets";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaPromptVersion, ComicDramaShot, ComicDramaShotDraft, ComicDramaShotInput } from "../types";
import { ShotDeleteImpactModal } from "./shot-delete-impact-modal";
import { ShotDraftModal } from "./shot-draft-modal";

const SHOT_SIZES = [
    { value: "远景", label: "远景 (Extreme Long Shot / 交代环境全貌)" },
    { value: "全景", label: "全景 (Long Shot / 人物全身与空间)" },
    { value: "中景", label: "中景 (Medium Shot / 半身至腰部)" },
    { value: "近景", label: "近景 (Medium Close-Up / 胸部以上)" },
    { value: "特写", label: "特写 (Close-Up / 面部微表情或关键道具)" },
    { value: "大特写", label: "大特写 (Extreme Close-Up / 眼神与细节)" },
];

const CAMERA_MOVEMENTS = [
    { value: "固定镜头", label: "固定镜头 (Static)" },
    { value: "缓慢推进", label: "缓慢推进 (Push In / 聚焦情绪)" },
    { value: "缓慢拉远", label: "缓慢拉远 (Pull Out / 揭示环境)" },
    { value: "横向摇摄", label: "横向摇摄 (Pan / 环视全景)" },
    { value: "纵向俯仰", label: "纵向俯仰 (Tilt / 展现高大或压抑)" },
    { value: "跟随移动", label: "跟随移动 (Tracking / 动作跟拍)" },
    { value: "环绕旋转", label: "环绕旋转 (Orbit / 动态张力)" },
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    draft: { label: "草稿", color: "default" },
    ready: { label: "就绪", color: "blue" },
    generating: { label: "生成中", color: "processing" },
    completed: { label: "已完成", color: "success" },
    failed: { label: "失败", color: "error" },
    needsUpdate: { label: "需要更新", color: "warning" },
};

/** 镜头拆分与清单阶段视图。 */
export function StageShots() {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const pendingImpactTargets = usePendingImpactTargets();
    const workspace = useComicDramaStore((state) => state.workspace);
    const saveShot = useComicDramaStore((state) => state.saveShot);
    const reorderShots = useComicDramaStore((state) => state.reorderShots);
    const generateShotDraft = useComicDramaStore((state) => state.generateShotDraft);
    const generateFinalVideoPrompt = useComicDramaStore((state) => state.generateFinalVideoPrompt);

    // Filters
    const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>("all");
    const [selectedSceneId, setSelectedSceneId] = useState<string>("all");

    // Modals
    const [splitModalOpen, setSplitModalOpen] = useState(false);
    const [draftReviewOpen, setDraftReviewOpen] = useState(false);
    const [shotDrawerOpen, setShotDrawerOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [targetShotForDelete, setTargetShotForDelete] = useState<ComicDramaShot | null>(null);
    const [promptDetail, setPromptDetail] = useState<{ shotNumber: number; prompt: ComicDramaPromptVersion } | null>(null);

    // AI Split form state
    const [splitEpisodeId, setSplitEpisodeId] = useState<string>("");
    const [splitSceneId, setSplitSceneId] = useState<string>("");
    const [splitShotCount, setSplitShotCount] = useState<number>(6);
    const [splitRhythm, setSplitRhythm] = useState<string>("紧凑利落");
    const [splitFocus, setSplitFocus] = useState<string>("突出人物冲突与关键动作");
    const [splitModel, setSplitModel] = useState<string>("");
    const [splitting, setSplitting] = useState(false);
    const [promptModel, setPromptModel] = useState<string>("");
    const [composingPromptShotId, setComposingPromptShotId] = useState<string | null>(null);
    const [batchComposeProgress, setBatchComposeProgress] = useState<{ done: number; total: number } | null>(null);
    const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);

    // Edit shot form
    const [editingShot, setEditingShot] = useState<ComicDramaShot | null>(null);
    const [shotForm] = Form.useForm<ComicDramaShotInput>();
    const [savingShot, setSavingShot] = useState(false);

    useEffect(() => {
        if (!promptModel && config.textModel) {
            setPromptModel(config.textModel);
        }
    }, [config.textModel, promptModel]);

    if (!workspace) return null;

    const episodes = workspace.scriptProject.episodes || [];
    const shots = workspace.shots || [];
    const pendingDraft = workspace.shotDrafts.find((d) => d.status === "pending") || null;

    // Available scenes for the selected episode filter
    const currentEpisode = episodes.find((e) => e.id === selectedEpisodeId);
    const availableScenes = currentEpisode?.scenes || [];

    // Filtered shots list
    const filteredShots = useMemo(() => {
        return shots
            .filter((shot) => {
                if (selectedEpisodeId !== "all" && shot.sourceEpisodeId !== selectedEpisodeId) return false;
                if (selectedSceneId !== "all" && shot.sourceSceneId !== selectedSceneId) return false;
                return true;
            })
            .sort((a, b) => a.sortOrder - b.sortOrder);
    }, [shots, selectedEpisodeId, selectedSceneId]);

    // 视频任务只读取已采用的提示词版本，列表也只展示该版本以保证所见即所用。
    const finalVideoPrompts = useMemo(() => {
        const promptsByShotId = new Map<string, ComicDramaPromptVersion>();
        for (const prompt of workspace.promptVersions) {
            if (prompt.status !== "adopted") continue;
            const current = promptsByShotId.get(prompt.shotId);
            if (!current || prompt.versionNumber > current.versionNumber) {
                promptsByShotId.set(prompt.shotId, prompt);
            }
        }
        return promptsByShotId;
    }, [workspace.promptVersions]);

    // 供「仅选未生成提示词」使用，仍以已采用的最终提示词为准。
    const shotsMissingFinalPrompt = useMemo(
        () => filteredShots.filter((shot) => !finalVideoPrompts.has(shot.id)),
        [filteredShots, finalVideoPrompts],
    );
    // 镜头关联的资产版本图：已生成（含被标记为需要更新）的第一张作为缩略图
    const assetImageByVersionId = useMemo(() => {
        const images = new Map<string, string>();
        for (const media of workspace?.media || []) {
            if (media.targetType !== "assetVersion" || media.mediaType !== "image") continue;
            if (media.status !== "completed" && media.status !== "needsUpdate") continue;
            const url = readComicDramaMediaUrl(media.resultData);
            if (url && !images.has(media.targetId)) images.set(media.targetId, url);
        }
        return images;
    }, [workspace]);

    const composingPrompts = Boolean(composingPromptShotId) || Boolean(batchComposeProgress);

    // 选中集合跨筛选保留，批量生成按镜头顺序串行处理。
    const selectedShots = useMemo(
        () => shots.filter((shot) => selectedShotIds.includes(shot.id)).sort((a, b) => a.sortOrder - b.sortOrder),
        [shots, selectedShotIds],
    );
    const selectedInFilteredCount = filteredShots.filter((shot) => selectedShotIds.includes(shot.id)).length;

    const toggleShotSelection = (shotId: string, checked: boolean) => {
        setSelectedShotIds((current) => (checked ? [...current, shotId] : current.filter((id) => id !== shotId)));
    };

    // 全选/取消只作用于当前筛选结果，跨筛选已选的镜头保留
    const toggleAllShotsFiltered = (checked: boolean) => {
        const filteredIds = filteredShots.map((shot) => shot.id);
        setSelectedShotIds((current) => (checked
            ? Array.from(new Set([...current, ...filteredIds]))
            : current.filter((id) => !filteredIds.includes(id))));
    };

    // 一键选中当前筛选结果里还没有最终提示词的镜头
    const selectShotsMissingFinalPrompt = () => {
        setSelectedShotIds(shotsMissingFinalPrompt.map((shot) => shot.id));
    };

    // Open AI shot split modal
    const openSplitModal = () => {
        // 与手动新建镜头保持同一套默认值：优先用镜头清单当前筛选的分集，而不是固定第一集，
        // 否则在筛选到第 5 集时点「AI 自动拆分镜头」，默认拆的却是第 1 集。
        setSplitEpisodeId(selectedEpisodeId !== "all" ? selectedEpisodeId : episodes[0]?.id || "");
        setSplitSceneId("");
        setSplitModel(config.textModel || "");
        setSplitModalOpen(true);
    };

    // Trigger AI shot split
    const handleTriggerSplit = async () => {
        if (!splitModel) {
            message.warning("请选择文本模型");
            return;
        }
        setSplitting(true);
        try {
            await generateShotDraft({
                episodeId: splitEpisodeId || undefined,
                sceneId: splitSceneId || undefined,
                shotCount: splitShotCount,
                rhythm: splitRhythm,
                focus: splitFocus,
                model: splitModel,
            });
            message.success("已生成镜头拆分草稿，请审核并微调");
            setSplitModalOpen(false);
            setDraftReviewOpen(true);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSplitting(false);
        }
    };

    // Open manual shot creation
    const openCreateShot = () => {
        setEditingShot(null);
        shotForm.resetFields();
        const nextShotNumber = shots.length > 0 ? Math.max(...shots.map((s) => s.shotNumber)) + 1 : 1;
        shotForm.setFieldsValue({
            id: `shot_${Date.now()}`,
            sourceEpisodeId: selectedEpisodeId !== "all" ? selectedEpisodeId : episodes[0]?.id,
            sourceSceneId: selectedSceneId !== "all" ? selectedSceneId : undefined,
            sourceScriptExcerpt: "",
            shotNumber: nextShotNumber,
            sortOrder: shots.length,
            durationSeconds: 3,
            shotSize: "中景",
            composition: "",
            visualDescription: "",
            actionDescription: "",
            cameraMovement: "固定镜头",
            lightingAtmosphere: "",
            dialogueVoiceover: "",
            soundDescription: "",
            styleOverride: "",
            productionStatus: "draft",
            assetVersionIds: [],
            revision: 0,
        });
        setShotDrawerOpen(true);
    };

    // Open shot edit
    const openEditShot = (shot: ComicDramaShot) => {
        setEditingShot(shot);
        shotForm.setFieldsValue({
            id: shot.id,
            sourceEpisodeId: shot.sourceEpisodeId,
            sourceSceneId: shot.sourceSceneId,
            sourceScriptExcerpt: shot.sourceScriptExcerpt,
            shotNumber: shot.shotNumber,
            sortOrder: shot.sortOrder,
            durationSeconds: shot.durationSeconds,
            shotSize: shot.shotSize,
            composition: shot.composition,
            visualDescription: shot.visualDescription,
            actionDescription: shot.actionDescription,
            cameraMovement: shot.cameraMovement,
            lightingAtmosphere: shot.lightingAtmosphere,
            dialogueVoiceover: shot.dialogueVoiceover,
            soundDescription: shot.soundDescription,
            styleOverride: shot.styleOverride,
            productionStatus: shot.productionStatus,
            assetVersionIds: shot.assetVersionIds,
            revision: shot.revision,
        });
        setShotDrawerOpen(true);
    };

    // Save shot
    const handleSaveShot = async () => {
        try {
            const values = await shotForm.validateFields();
            setSavingShot(true);
            await saveShot(values);
            message.success(editingShot ? "镜头已更新" : "新镜头已创建");
            setShotDrawerOpen(false);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSavingShot(false);
        }
    };

    // Move shot up/down
    const handleMoveShot = async (index: number, direction: "up" | "down") => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= filteredShots.length) return;

        const reordered = [...filteredShots];
        const temp = reordered[index];
        reordered[index] = reordered[targetIndex];
        reordered[targetIndex] = temp;

        const shotIds = reordered.map((s) => s.id);
        try {
            await reorderShots(shotIds);
            message.success("镜头顺序已调整");
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    // Open delete confirmation
    const openDeleteShot = (shot: ComicDramaShot) => {
        setTargetShotForDelete(shot);
        setDeleteModalOpen(true);
    };

    // 生成后立即采用该版本，保证随后的生视频任务读取到同一份最终提示词。
    const handleGenerateFinalVideoPrompt = async (shot: ComicDramaShot) => {
        if (composingPromptShotId) return;
        if (!promptModel) {
            message.warning("请选择提示词模型");
            return;
        }
        setComposingPromptShotId(shot.id);
        try {
            const prompt = await generateFinalVideoPrompt(shot.id, promptModel);
            message.success(`镜头 #${shot.shotNumber} 的最终视频提示词已生成并采用（v${prompt.versionNumber}）`);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setComposingPromptShotId(null);
        }
    };

    // 对勾选的镜头逐个生成并采用；已有提示词的镜头会生成新版本覆盖，串行处理避免并发 reloadWorkspace 互相覆盖。
    const handleBatchGenerateFinalVideoPrompts = async () => {
        if (composingPrompts || selectedShots.length === 0) return;
        if (!promptModel) {
            message.warning("请选择提示词模型");
            return;
        }
        let failed = 0;
        for (let index = 0; index < selectedShots.length; index += 1) {
            setBatchComposeProgress({ done: index, total: selectedShots.length });
            try {
                await generateFinalVideoPrompt(selectedShots[index].id, promptModel);
            } catch {
                failed += 1;
            }
        }
        setBatchComposeProgress(null);
        const succeeded = selectedShots.length - failed;
        if (failed > 0) message.warning(`已生成并采用 ${succeeded} 个镜头的最终提示词，${failed} 个失败`);
        else message.success(`已生成并采用 ${succeeded} 个镜头的最终提示词`);
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">镜头拆分与清单</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        将剧本场次拆分为连续、可执行的画面镜头单元。支持 AI 智能拆解并生成草稿审核，也可手动精确调整景别、构图、运镜与对白。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={<Sparkles className="size-4 text-purple-500" />} onClick={openSplitModal}>
                        AI 自动拆分镜头
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreateShot}>
                        添加镜头
                    </Button>
                </div>
            </header>

            {/* Pending Draft Alert Banner */}
            {pendingDraft && (
                <div className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
                    <div className="flex items-center gap-3">
                        <Sparkles className="size-5 text-purple-500" />
                        <div>
                            <span className="font-semibold text-[var(--studio-ink)]">存在待确认的镜头拆分草稿</span>
                            <p className="text-xs text-[var(--studio-muted)]">
                                包含已拆分的候选镜头，微调确认后将正式追加至镜头清单中。
                            </p>
                        </div>
                    </div>
                    <Button type="primary" size="small" onClick={() => setDraftReviewOpen(true)}>
                        审核并编辑草稿
                    </Button>
                </div>
            )}

            {/* Episode & Scene Filter Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--studio-muted)]">分集筛选：</span>
                    <Select
                        className="w-36"
                        value={selectedEpisodeId}
                        onChange={(val) => {
                            setSelectedEpisodeId(val);
                            setSelectedSceneId("all");
                        }}
                        options={[
                            { value: "all", label: "全部分集" },
                            ...episodes.map((ep) => ({
                                value: ep.id,
                                label: `第${ep.episodeNumber}集：${ep.title || "无标题"}`,
                            })),
                        ]}
                    />

                    {selectedEpisodeId !== "all" && availableScenes.length > 0 && (
                        <>
                            <span className="ml-2 text-xs font-medium text-[var(--studio-muted)]">场次：</span>
                            <Select
                                className="w-36"
                                value={selectedSceneId}
                                onChange={setSelectedSceneId}
                                options={[
                                    { value: "all", label: "全部场次" },
                                    ...availableScenes.map((sc) => ({
                                        value: sc.id,
                                        label: `第${sc.sceneNumber}场：${sc.location || "未设地点"}`,
                                    })),
                                ]}
                            />
                        </>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[var(--studio-muted)]">提示词模型：</span>
                        <div className="w-44">
                            <ModelPicker config={config} capability="text" value={promptModel} onChange={setPromptModel} fullWidth />
                        </div>
                    </div>
                    <div className="text-xs text-[var(--studio-muted)]">
                        共 <strong className="text-[var(--studio-ink)]">{filteredShots.length}</strong> 个镜头 · 总时长约{" "}
                        <strong className="text-[var(--studio-ink)]">
                            {filteredShots.reduce((acc, cur) => acc + Number(cur.durationSeconds || 0), 0).toFixed(1)}s
                        </strong>
                    </div>
                </div>
            </div>

            {/* 最终提示词批量生成操作栏 */}
            {filteredShots.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                    <Checkbox
                        indeterminate={selectedInFilteredCount > 0 && selectedInFilteredCount < filteredShots.length}
                        checked={filteredShots.length > 0 && selectedInFilteredCount === filteredShots.length}
                        onChange={(e) => toggleAllShotsFiltered(e.target.checked)}
                    >
                        全选当前 ({filteredShots.length})
                    </Checkbox>
                    <Button
                        type="text"
                        size="small"
                        disabled={shotsMissingFinalPrompt.length === 0}
                        onClick={selectShotsMissingFinalPrompt}
                    >
                        仅选未生成提示词
                    </Button>
                    <span className="text-xs text-[var(--studio-muted)]">已选 {selectedShots.length} 项</span>
                    <div className="ml-auto">
                        <Button
                            icon={<Sparkles className="size-4 text-purple-500" />}
                            loading={Boolean(batchComposeProgress)}
                            disabled={composingPrompts || selectedShots.length === 0}
                            onClick={() => void handleBatchGenerateFinalVideoPrompts()}
                        >
                            {batchComposeProgress
                                ? `批量生成中 ${batchComposeProgress.done}/${batchComposeProgress.total}`
                                : `批量生成最终提示词${selectedShots.length > 0 ? `（${selectedShots.length}）` : ""}`}
                        </Button>
                    </div>
                </div>
            )}

            {/* Shot List Table / Cards */}
            {filteredShots.length === 0 ? (
                <Empty description="当前筛选条件下没有镜头">
                    <Space>
                        <Button type="primary" icon={<Sparkles className="size-4" />} onClick={openSplitModal}>
                            AI 自动拆分镜头
                        </Button>
                        <Button icon={<Plus className="size-4" />} onClick={openCreateShot}>
                            手动添加镜头
                        </Button>
                    </Space>
                </Empty>
            ) : (
                <div className="flex flex-col gap-3">
                    {filteredShots.map((shot, idx) => {
                        // 上游变更只登记影响项，不再改动镜头状态，因此「需要更新」由待确认项派生
                        const pendingUpdate = pendingImpactTargets.has(`shot:${shot.id}`);
                        const statusInfo = pendingUpdate && shot.productionStatus !== "needsUpdate"
                            ? { label: "需要更新", color: "warning" }
                            : STATUS_MAP[shot.productionStatus] || STATUS_MAP.draft;
                        const finalVideoPrompt = finalVideoPrompts.get(shot.id);
                        return (
                            <div
                                key={shot.id}
                                className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--studio-line)] bg-[var(--studio-panel-solid)] p-4 transition-all hover:border-[var(--studio-line-strong)]"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-line)] pb-2.5">
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            checked={selectedShotIds.includes(shot.id)}
                                            onChange={(e) => toggleShotSelection(shot.id, e.target.checked)}
                                            aria-label={`选择镜头 #${shot.shotNumber}`}
                                        />
                                        <span className="rounded bg-[var(--studio-line)] px-2 py-0.5 font-mono text-sm font-semibold text-[var(--studio-ink)]">
                                            #{shot.shotNumber}
                                        </span>
                                        <Tag color="cyan">{shot.shotSize || "未定景别"}</Tag>
                                        <Tag color="geekblue">{shot.cameraMovement || "固定镜头"}</Tag>
                                        <span className="text-xs text-[var(--studio-muted)]">{shot.durationSeconds}s</span>
                                        <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
                                    </div>

                                    <div className="flex orientation-row items-center gap-1">
                                        <Button
                                            size="small"
                                            type="text"
                                            disabled={idx === 0}
                                            icon={<ArrowUp className="size-3.5" />}
                                            onClick={() => handleMoveShot(idx, "up")}
                                            title="上移"
                                        />
                                        <Button
                                            size="small"
                                            type="text"
                                            disabled={idx === filteredShots.length - 1}
                                            icon={<ArrowDown className="size-3.5" />}
                                            onClick={() => handleMoveShot(idx, "down")}
                                            title="下移"
                                        />
                                        <Button
                                            size="small"
                                            icon={<Edit className="size-3.5" />}
                                            onClick={() => openEditShot(shot)}
                                        >
                                            编辑
                                        </Button>
                                        <Button
                                            size="small"
                                            danger
                                            type="text"
                                            icon={<Trash2 className="size-3.5" />}
                                            onClick={() => openDeleteShot(shot)}
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-3 text-xs sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                                    <div>
                                        <span className="font-medium text-[var(--studio-muted)]">画面构图与内容：</span>
                                        <p className="mt-1 leading-5 text-[var(--studio-text)]">
                                            {shot.visualDescription || "暂无画面描述"}
                                        </p>
                                    </div>

                                    <div>
                                        <span className="font-medium text-[var(--studio-muted)]">对白与声音：</span>
                                        <p className="mt-1 leading-5 text-[var(--studio-text)]">
                                            {shot.dialogueVoiceover ? `“${shot.dialogueVoiceover}”` : "无台词/纯画面"}
                                        </p>
                                        {shot.soundDescription && (
                                            <p className="mt-0.5 text-[var(--studio-faint)]">
                                                音效：{shot.soundDescription}
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <span className="font-medium text-[var(--studio-muted)]">光线氛围与资产：</span>
                                        <p className="mt-1 text-[var(--studio-text)]">
                                            {shot.lightingAtmosphere || "自然光影"}
                                        </p>
                                        {shot.assetVersionIds && shot.assetVersionIds.length > 0 && (
                                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                {shot.assetVersionIds.map((versionId) => {
                                                    const assetImageUrl = assetImageByVersionId.get(versionId);
                                                    const versionLabel = versionId.split("_")[1] || versionId;
                                                    return assetImageUrl ? (
                                                        <Image
                                                            key={versionId}
                                                            src={assetImageUrl}
                                                            alt={`资产版本 ${versionLabel}`}
                                                            width={52}
                                                            height={52}
                                                            className="size-[52px] rounded-md border border-[var(--studio-line)] object-cover"
                                                            classNames={{ root: "overflow-hidden rounded-md" }}
                                                            title={versionLabel}
                                                        />
                                                    ) : (
                                                        <span
                                                            key={versionId}
                                                            title={`资产版本 ${versionLabel} 尚未生成图片`}
                                                            className="flex size-[52px] items-center justify-center rounded-md border border-dashed border-[var(--studio-line-strong)] text-[var(--studio-muted)]"
                                                        >
                                                            <ImageIcon className="size-4" />
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium text-[var(--studio-muted)]">最终视频提示词：</span>
                                            <Button
                                                size="small"
                                                type="text"
                                                icon={<Sparkles className="size-3.5" />}
                                                loading={composingPromptShotId === shot.id}
                                                disabled={composingPrompts || !promptModel}
                                                onClick={() => void handleGenerateFinalVideoPrompt(shot)}
                                            >
                                                {finalVideoPrompt ? "重新生成" : "AI 生成"}
                                            </Button>
                                        </div>
                                        {finalVideoPrompt ? (
                                            <Button
                                                type="text"
                                                block
                                                className="mt-1 !h-auto !p-0 text-left"
                                                aria-label={`查看镜头 #${shot.shotNumber} 的最终视频提示词详情`}
                                                onClick={() => setPromptDetail({ shotNumber: shot.shotNumber, prompt: finalVideoPrompt })}
                                            >
                                                <span className="line-clamp-3 whitespace-normal text-left leading-5 text-[var(--studio-text)]" title={finalVideoPrompt.prompt}>
                                                    {finalVideoPrompt.prompt}
                                                </span>
                                            </Button>
                                        ) : (
                                            <p className="mt-1 leading-5 text-[var(--studio-text)]">暂未生成，可使用 AI 生成后直接用于生视频。</p>
                                        )}
                                        {finalVideoPrompt ? (
                                            <p className="mt-1 text-[10px] text-[var(--studio-faint)]">
                                                已采用 v{finalVideoPrompt.versionNumber}
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* AI Shot Split Modal */}
            <Modal
                title={
                    <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-purple-500" />
                        <span>AI 智能拆分镜头</span>
                    </div>
                }
                open={splitModalOpen}
                onCancel={() => setSplitModalOpen(false)}
                footer={null}
                width={560}
            >
                <div className="flex flex-col gap-4 py-2">
                    <p className="text-xs text-[var(--studio-muted)]">
                        分镜 Agent 将解析所选范围的剧本正文与人物对白，结合项目视觉风格智能拆解为连续镜头草稿。生成的草稿必须经过您的审核确认后才会生效。
                    </p>

                    <div>
                        <label className="text-xs font-medium text-[var(--studio-muted)]">拆分范围（分集）</label>
                        <Select
                            className="mt-1 w-full"
                            value={splitEpisodeId}
                            onChange={(val) => {
                                setSplitEpisodeId(val);
                                setSplitSceneId("");
                            }}
                            options={episodes.map((ep) => ({
                                value: ep.id,
                                label: `第${ep.episodeNumber}集：${ep.title || "无标题"}`,
                            }))}
                        />
                    </div>

                    {splitEpisodeId && (
                        <div>
                            <label className="text-xs font-medium text-[var(--studio-muted)]">指定场次（可选）</label>
                            <Select
                                className="mt-1 w-full"
                                value={splitSceneId}
                                onChange={setSplitSceneId}
                                options={[
                                    { value: "", label: "拆分整集剧本" },
                                    ...(episodes.find((e) => e.id === splitEpisodeId)?.scenes || []).map((sc) => ({
                                        value: sc.id,
                                        label: `第${sc.sceneNumber}场：${sc.location || "未设地点"}`,
                                    })),
                                ]}
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-[var(--studio-muted)]">预计镜头数量</label>
                            <InputNumber
                                min={1}
                                max={50}
                                className="mt-1 w-full"
                                value={splitShotCount}
                                onChange={(val) => setSplitShotCount(val || 6)}
                            />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-[var(--studio-muted)]">叙事节奏</label>
                            <Select
                                className="mt-1 w-full"
                                value={splitRhythm}
                                onChange={setSplitRhythm}
                                options={[
                                    { value: "紧凑利落", label: "紧凑利落 (短剧快节奏)" },
                                    { value: "高潮反转", label: "高潮反转 (悬疑与爆发)" },
                                    { value: "舒缓写意", label: "舒缓写意 (情感烘托)" },
                                    { value: "激烈打斗", label: "激烈打斗 (快速切换)" },
                                ]}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-[var(--studio-muted)]">创作重点指示</label>
                        <Input
                            className="mt-1"
                            value={splitFocus}
                            onChange={(e) => setSplitFocus(e.target.value)}
                            placeholder="例如：突出男女主角眼神拉扯，重点呈现雨夜氛围"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-medium text-[var(--studio-muted)]">拆分模型</label>
                        <div className="mt-1">
                            <ModelPicker
                                config={config}
                                capability="text"
                                value={splitModel}
                                onChange={setSplitModel}
                                fullWidth
                            />
                        </div>
                    </div>

                    <div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--studio-line)] pt-3">
                        <Button onClick={() => setSplitModalOpen(false)}>取消</Button>
                        <Button
                            type="primary"
                            loading={splitting}
                            icon={<Sparkles className="size-4" />}
                            onClick={handleTriggerSplit}
                        >
                            开始拆分
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                title={`镜头 #${promptDetail?.shotNumber ?? ""} 的最终视频提示词`}
                open={Boolean(promptDetail)}
                onCancel={() => setPromptDetail(null)}
                footer={<Button onClick={() => setPromptDetail(null)}>关闭</Button>}
                width={720}
            >
                <p className="mb-3 text-xs text-[var(--studio-muted)]">已采用 v{promptDetail?.prompt.versionNumber}</p>
                <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words leading-6 text-[var(--studio-text)]">
                    {promptDetail?.prompt.prompt}
                </div>
            </Modal>

            {/* Shot Edit / Create Drawer */}
            <Drawer
                title={editingShot ? `编辑镜头 #${editingShot.shotNumber}` : "新建镜头"}
                open={shotDrawerOpen}
                onClose={() => setShotDrawerOpen(false)}
                size="large"
                extra={
                    <Button type="primary" loading={savingShot} onClick={handleSaveShot}>
                        保存
                    </Button>
                }
            >
                <Form form={shotForm} layout="vertical">
                    <Form.Item name="id" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item name="sortOrder" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item name="revision" hidden>
                        <Input />
                    </Form.Item>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item
                            name="shotNumber"
                            label="镜号"
                            rules={[{ required: true, message: "请输入镜号" }]}
                        >
                            <InputNumber min={1} className="w-full" />
                        </Form.Item>

                        <Form.Item
                            name="durationSeconds"
                            label="预估时长 (秒)"
                            rules={[{ required: true, message: "请输入时长" }]}
                        >
                            <InputNumber min={0.5} max={120} step={0.5} className="w-full" />
                        </Form.Item>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="shotSize" label="景别">
                            <Select options={SHOT_SIZES} />
                        </Form.Item>

                        <Form.Item name="cameraMovement" label="摄影机运动">
                            <Select options={CAMERA_MOVEMENTS} />
                        </Form.Item>
                    </div>

                    <Form.Item
                        name="visualDescription"
                        label="画面构图与视觉描述"
                        rules={[{ required: true, message: "请填写画面描述" }]}
                    >
                        <Input.TextArea rows={3} placeholder="人物在画面的位置、环境细节、动作发生..." />
                    </Form.Item>

                    <Form.Item name="actionDescription" label="人物与物体动作">
                        <Input placeholder="例如：拔剑指向前方，眼神坚定" />
                    </Form.Item>

                    <Form.Item name="dialogueVoiceover" label="对白或旁白">
                        <Input.TextArea rows={2} placeholder="角色在此镜头中说出的台词，或画外音旁白" />
                    </Form.Item>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="lightingAtmosphere" label="光线、天气与氛围">
                            <Input placeholder="例如：暖阳斜照、雷暴雨夜" />
                        </Form.Item>

                        <Form.Item name="soundDescription" label="环境音与关键音效">
                            <Input placeholder="例如：刀剑出鞘金属音、急促雨点声" />
                        </Form.Item>
                    </div>

                    <Form.Item name="productionStatus" label="制作状态">
                        <Select
                            options={[
                                { value: "draft", label: "草稿 (Draft)" },
                                { value: "ready", label: "就绪 (Ready)" },
                                { value: "completed", label: "已完成 (Completed)" },
                                { value: "needsUpdate", label: "需要更新 (Needs Update)" },
                            ]}
                        />
                    </Form.Item>
                </Form>
            </Drawer>

            {/* Shot Draft Review Drawer */}
            <ShotDraftModal
                draft={pendingDraft}
                open={draftReviewOpen}
                onClose={() => setDraftReviewOpen(false)}
            />

            {/* Shot Delete Impact Modal */}
            <ShotDeleteImpactModal
                shot={targetShotForDelete}
                open={deleteModalOpen}
                onClose={() => {
                    setDeleteModalOpen(false);
                    setTargetShotForDelete(null);
                }}
            />
        </div>
    );
}
