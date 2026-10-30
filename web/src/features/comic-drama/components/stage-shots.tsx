"use client";

import { productionParameterLabel } from "../lib/production-labels";

import { translateMessage } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";

import { useEffect, useMemo, useState } from "react";
import { creditAmount, creditText } from "@/shared/lib/credit-amounts";
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
import { useFinalPromptPricing } from "../hooks/use-final-prompt-pricing";
import { useFinalPromptConfirmation } from "../hooks/use-final-prompt-confirmation";
import { usePendingImpactTargets } from "../hooks/use-pending-impact-targets";
import { useComicDramaStore } from "../stores/use-comic-drama-store";
import type { ComicDramaPromptVersion, ComicDramaShot, ComicDramaShotDraft, ComicDramaShotInput } from "../types";
import { ShotDeleteImpactModal } from "./shot-delete-impact-modal";
import { ShotDraftModal } from "./shot-draft-modal";
import { readPromptBody } from "../lib/prompt-references";
import { PromptReferenceInstructions } from "./prompt-reference-instructions";

const getShotSizes = (translate = translateMessage) => ([
    { value: "远景", label: translate("comicDrama.extremeLongShotOverallEnvironment") },
    { value: "全景", label: translate("comicDrama.longShotFullBodyAndSurroundings") },
    { value: "中景", label: translate("comicDrama.mediumShotWaistUp") },
    { value: "近景", label: translate("comicDrama.mediumCloseUpChestUp") },
    { value: "特写", label: translate("comicDrama.closeUpFacialDetailsOrKeyProps") },
    { value: "大特写", label: translate("comicDrama.extremeCloseUpEyesAndFineDetails") },
]);

const getCameraMovements = (translate = translateMessage) => ([
    { value: "固定镜头", label: translate("comicDrama.staticCamera_f7eff2") },
    { value: "缓慢推进", label: translate("comicDrama.slowPushInEmotionalFocus") },
    { value: "缓慢拉远", label: translate("comicDrama.slowPullOutRevealSurroundings") },
    { value: "横向摇摄", label: translate("comicDrama.panSurveyTheScene") },
    { value: "纵向俯仰", label: translate("comicDrama.tiltHeightOrPressure") },
    { value: "跟随移动", label: translate("comicDrama.trackingFollowAction") },
    { value: "环绕旋转", label: translate("comicDrama.orbitDynamicTension") },
]);

const getStatusMap = (translate = translateMessage): Record<string, { label: string; color: string }> => ({
    draft: { label: translate("comicDrama.draft"), color: "default" },
    ready: { label: translate("comicDrama.ready_b796f2"), color: "blue" },
    generating: { label: translate("comicDrama.generating"), color: "processing" },
    completed: { label: translate("comicDrama.completed_e99b48"), color: "success" },
    failed: { label: translate("comicDrama.failed_3e3c80"), color: "error" },
    needsUpdate: { label: translate("comicDrama.needsUpdate"), color: "warning" },
});

/** 镜头拆分与清单阶段视图。 */
export function StageShots() {
    const translate = useTranslation();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const pendingImpactTargets = usePendingImpactTargets();
    const workspace = useComicDramaStore((state) => state.workspace);
    const saveShot = useComicDramaStore((state) => state.saveShot);
    const reorderShots = useComicDramaStore((state) => state.reorderShots);
    const generateShotDraft = useComicDramaStore((state) => state.generateShotDraft);
    const generateFinalVideoPrompt = useComicDramaStore((state) => state.generateFinalVideoPrompt);
    const composePromptsBatch = useComicDramaStore((state) => state.composePromptsBatch);
    const savePrompt = useComicDramaStore((state) => state.savePrompt);

    // Filters
    const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>("all");
    const [selectedSceneId, setSelectedSceneId] = useState<string>("all");

    // Modals
    const [splitModalOpen, setSplitModalOpen] = useState(false);
    const [draftReviewOpen, setDraftReviewOpen] = useState(false);
    const [shotDrawerOpen, setShotDrawerOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [targetShotForDelete, setTargetShotForDelete] = useState<ComicDramaShot | null>(null);
    const [promptDetail, setPromptDetail] = useState<{ shotId: string; shotNumber: number; prompt: ComicDramaPromptVersion } | null>(null);
    const [promptDetailDraft, setPromptDetailDraft] = useState("");
    const [savingPromptDetail, setSavingPromptDetail] = useState(false);
    /* 镜头编辑抽屉里的最终提示词草稿：提示词是独立版本记录，不参与镜头表单校验。 */
    const [promptDraft, setPromptDraft] = useState("");
    const [promptDraftSource, setPromptDraftSource] = useState<ComicDramaPromptVersion | null>(null);

    // AI Split form state
    const [splitEpisodeId, setSplitEpisodeId] = useState<string>("");
    const [splitSceneId, setSplitSceneId] = useState<string>("");
    // 预计镜头数量默认留空，由模型按剧本内容自行判断；填了才按填的数量拆分。
    const [splitShotCount, setSplitShotCount] = useState<number | null>(null);
    const [splitRhythm, setSplitRhythm] = useState<string>("紧凑利落");
    // 创作重点不预填，改成输入框里的帮助提示，避免每次都要先删掉默认文案。
    const [splitFocus, setSplitFocus] = useState<string>("");
    const [splitModel, setSplitModel] = useState<string>("");
    const [splitting, setSplitting] = useState(false);
    const [promptModel, setPromptModel] = useState<string>("");
    const [composingPromptShotId, setComposingPromptShotId] = useState<string | null>(null);
    const [batchComposeProgress, setBatchComposeProgress] = useState<{ total: number } | null>(null);
    const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
    const confirmFinalPrompt = useFinalPromptConfirmation(workspace?.projectId);

    const pricingQuery = useFinalPromptPricing(promptModel, Boolean(workspace));
    const { ready: pricingReady, reason: pricingReason } = pricingQuery;

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

    // 选中集合跨筛选保留，批量生成时按镜头顺序一次性提交给服务端并发处理。
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
            message.warning(translate("comicDrama.selectATextModel"));
            return;
        }
        setSplitting(true);
        try {
            await generateShotDraft({
                episodeId: splitEpisodeId || undefined,
                sceneId: splitSceneId || undefined,
                shotCount: splitShotCount ?? undefined,
                rhythm: splitRhythm,
                focus: splitFocus,
                model: splitModel,
            });
            message.success(translate("comicDrama.shotBreakdownDraftGeneratedReviewAndAdjustIt"));
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
        setPromptDraft("");
        setPromptDraftSource(null);
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
        const prompt = finalVideoPrompts.get(shot.id) || null;
        setPromptDraftSource(prompt);
        setPromptDraft(readPromptBody(prompt));
        setShotDrawerOpen(true);
    };

    // Save shot：镜头字段先落库，最终提示词有改动时另存为新采用版本，视频生成读到的就是这里的内容。
    const handleSaveShot = async () => {
        try {
            const values = await shotForm.validateFields();
            const currentPrompt = editingShot ? promptDraftSource : null;
            const nextPrompt = promptDraft.trim();
            if (!nextPrompt && currentPrompt) {
                message.warning(translate("comicDrama.promptCannotBeEmpty"));
                return;
            }
            setSavingShot(true);
            const saved = await saveShot(values);
            const shotId = saved.id || values.id || "";
            if (shotId && nextPrompt && nextPrompt !== readPromptBody(currentPrompt)) {
                // 不传期望版本号：清单展示的是「已采用」版本，可能落后于表内更大版本的草稿，传了会误判冲突。
                const version = await savePrompt(shotId, nextPrompt, undefined, currentPrompt?.id);
                message.success(translate("comicDrama.finalVideoPromptSavedAsVersion", { value0: version.versionNumber }));
            }
            message.success(editingShot ? translate("comicDrama.shotUpdated") : translate("comicDrama.newShotCreated"));
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
            message.success(translate("comicDrama.shotOrderUpdated"));
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        }
    };

    // Open delete confirmation
    const openDeleteShot = (shot: ComicDramaShot) => {
        setTargetShotForDelete(shot);
        setDeleteModalOpen(true);
    };

    // 打开最终提示词编辑弹层，草稿单独维护，取消时不改动已采用版本。
    const openPromptDetail = (shot: ComicDramaShot, prompt: ComicDramaPromptVersion) => {
        setPromptDetail({ shotId: shot.id, shotNumber: shot.shotNumber, prompt });
        setPromptDetailDraft(readPromptBody(prompt));
    };

    // 手动改提示词同样另存为新采用版本，保证视频生成与界面展示一致。
    const handleSavePromptDetail = async () => {
        if (!promptDetail) return;
        const nextPrompt = promptDetailDraft.trim();
        if (!nextPrompt) {
            message.warning(translate("comicDrama.promptCannotBeEmpty"));
            return;
        }
        if (nextPrompt === readPromptBody(promptDetail.prompt)) {
            setPromptDetail(null);
            return;
        }
        setSavingPromptDetail(true);
        try {
            const saved = await savePrompt(promptDetail.shotId, nextPrompt, undefined, promptDetail.prompt.id);
            message.success(translate("comicDrama.finalVideoPromptSavedAsVersion", { value0: saved.versionNumber }));
            setPromptDetail(null);
        } catch (error) {
            if (error instanceof Error) message.error(error.message);
        } finally {
            setSavingPromptDetail(false);
        }
    };

    // 生成后立即采用该版本，保证随后的生视频任务读取到同一份最终提示词。
    const handleGenerateFinalVideoPrompt = (shot: ComicDramaShot) => {
        if (composingPrompts || !pricingReady) return;
        if (!promptModel) {
            message.warning(translate("comicDrama.selectAPromptModel"));
            return;
        }
        const request = {
            projectId: workspace.projectId,
            shotId: shot.id,
            shotNumber: shot.shotNumber,
            model: promptModel,
            unitPrice: pricingQuery.data!.unitPrice!,
            revision: pricingQuery.data!.revision,
        };
        confirmFinalPrompt(1, request.unitPrice, async () => {
                setComposingPromptShotId(request.shotId);
                try {
                    const prompt = await generateFinalVideoPrompt(request.projectId, request.shotId, request.model, request.revision);
                    message.success(translate("comicDrama.finalVideoPromptForShotCountGeneratedAndAdoptedV", { value0: request.shotNumber, value1: prompt.versionNumber }));
                } catch (error) {
                    if (error instanceof Error) message.error(error.message);
                } finally {
                    setComposingPromptShotId(null);
                    void pricingQuery.refetch();
                }
        });
    };

    // 一次提交勾选的镜头，由服务端并发请求模型并统一采用，失败镜头单独返回。
    const handleBatchGenerateFinalVideoPrompts = () => {
        if (composingPrompts || selectedShots.length === 0 || !pricingReady) return;
        if (!promptModel) {
            message.warning(translate("comicDrama.selectAPromptModel"));
            return;
        }
        const request = {
            projectId: workspace.projectId,
            shotIds: selectedShots.map((shot) => shot.id),
            total: selectedShots.length,
            model: promptModel,
            unitPrice: pricingQuery.data!.unitPrice!,
            revision: pricingQuery.data!.revision,
        };
        confirmFinalPrompt(request.total, request.unitPrice, async () => {
                setBatchComposeProgress({ total: request.total });
                try {
                    const result = await composePromptsBatch(request.projectId, request.shotIds, request.model, request.revision);
                    const succeeded = result.succeededShotIds.length;
                    if (result.failedShotIds.length > 0) {
                        const summary = translate("comicDrama.generatedAndAdoptedFinalPromptsForCountShotsCountFailed", { value0: succeeded, value1: result.failedShotIds.length });
                        message.warning(result.failureMessage ? `${summary}：${result.failureMessage}` : summary);
                    } else message.success(translate("comicDrama.generatedAndAdoptedFinalPromptsForCountShots", { value0: succeeded }));
                } catch (error) {
                    if (error instanceof Error) message.error(error.message);
                } finally {
                    setBatchComposeProgress(null);
                    void pricingQuery.refetch();
                }
        });
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-2 border-b border-[var(--studio-line)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-[var(--studio-ink)]">{translate("comicDrama.shotBreakdownAndList")}</h2>
                    <p className="mt-1 text-sm text-[var(--studio-muted)]">
                        {translate("comicDrama.breakScriptScenesIntoContinuousActionableShotsGenerateAiDrafts")}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={<Sparkles className="size-4 text-purple-500" />} onClick={openSplitModal}>
                        {translate("comicDrama.breakDownShotsWithAi")}</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreateShot}>
                        {translate("comicDrama.addShot")}</Button>
                </div>
            </header>

            {/* Pending Draft Alert Banner */}
            {pendingDraft && (
                <div className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
                    <div className="flex items-center gap-3">
                        <Sparkles className="size-5 text-purple-500" />
                        <div>
                            <span className="font-semibold text-[var(--studio-ink)]">{translate("comicDrama.aShotBreakdownDraftIsAwaitingApproval")}</span>
                            <p className="text-xs text-[var(--studio-muted)]">
                                {translate("comicDrama.reviewAndAdjustTheProposedShotsBeforeAppendingThemTo")}</p>
                        </div>
                    </div>
                    <Button type="primary" size="small" onClick={() => setDraftReviewOpen(true)}>
                        {translate("comicDrama.reviewAndEditDraft")}</Button>
                </div>
            )}

            {/* Episode & Scene Filter Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.episodeFilter")}</span>
                    <Select
                        className="w-36"
                        value={selectedEpisodeId}
                        onChange={(val) => {
                            setSelectedEpisodeId(val);
                            setSelectedSceneId("all");
                        }}
                        options={[
                            { value: "all", label: translate("comicDrama.allEpisodes") },
                            ...episodes.map((ep) => ({
                                value: ep.id,
                                label: translate("comicDrama.episodeCountCount", { value0: ep.episodeNumber, value1: ep.title || translate("comicDrama.untitled") }),
                            })),
                        ]}
                    />

                    {selectedEpisodeId !== "all" && availableScenes.length > 0 && (
                        <>
                            <span className="ml-2 text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.scene_e22aac")}</span>
                            <Select
                                className="w-36"
                                value={selectedSceneId}
                                onChange={setSelectedSceneId}
                                options={[
                                    { value: "all", label: translate("comicDrama.allScenes") },
                                    ...availableScenes.map((sc) => ({
                                        value: sc.id,
                                        label: translate("comicDrama.sceneCountCount", { value0: sc.sceneNumber, value1: sc.location || translate("comicDrama.locationNotSet") }),
                                    })),
                                ]}
                            />
                        </>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.promptModel")}</span>
                        <div className="w-44">
                            <ModelPicker config={config} capability="text" value={promptModel} onChange={setPromptModel} fullWidth />
                        </div>
                    </div>
                    <div className="text-xs text-[var(--studio-muted)]">
                        {translate("comicDrama.total")}<strong className="text-[var(--studio-ink)]">{filteredShots.length}</strong> {translate("comicDrama.shotsTotalDurationApproximately")}{" "}
                        <strong className="text-[var(--studio-ink)]">
                            {filteredShots.reduce((acc, cur) => acc + Number(cur.durationSeconds || 0), 0).toFixed(1)}s
                        </strong>
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--studio-muted)]" aria-live="polite">
                <span>每镜头积分：{pricingReady ? creditText(pricingQuery.data!.unitPrice!) : "—"}</span>
                <span>所选镜头预计总积分：{pricingReady ? creditText(creditAmount(pricingQuery.data!.unitPrice!).mul(selectedShots.length).toFixed()) : "—"}</span>
                <Button size="small" loading={pricingQuery.isFetching} disabled={!promptModel || composingPrompts} onClick={() => void pricingQuery.refetch()}>刷新价格</Button>
            </div>
            {pricingReason ? <Alert type={pricingQuery.isError ? "error" : "info"} showIcon title={pricingReason} /> : null}

            {/* 最终提示词批量生成操作栏 */}
            {filteredShots.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                    <Checkbox
                        indeterminate={selectedInFilteredCount > 0 && selectedInFilteredCount < filteredShots.length}
                        checked={filteredShots.length > 0 && selectedInFilteredCount === filteredShots.length}
                        onChange={(e) => toggleAllShotsFiltered(e.target.checked)}
                    >{translate("comicDrama.selectCurrentCount_8b9873", { value0: filteredShots.length })}</Checkbox>
                    <Button
                        type="text"
                        size="small"
                        disabled={shotsMissingFinalPrompt.length === 0}
                        onClick={selectShotsMissingFinalPrompt}
                    >
                        {translate("comicDrama.selectWithoutPrompts")}</Button>
                    <span className="text-xs text-[var(--studio-muted)]">{translate("comicDrama.countItemsSelected_380fef", { value0: selectedShots.length })}</span>
                    <div className="ml-auto">
                        <Button
                            icon={<Sparkles className="size-4 text-purple-500" />}
                            loading={Boolean(batchComposeProgress)}
                            disabled={composingPrompts || selectedShots.length === 0 || !pricingReady}
                            onClick={() => void handleBatchGenerateFinalVideoPrompts()}
                        >
                            {batchComposeProgress
                                ? translate("comicDrama.generatingFinalPromptsForCountShots", { value0: batchComposeProgress.total })
                                : translate("comicDrama.generateFinalPromptsInBatchCount", { value0: selectedShots.length > 0 ? `（${selectedShots.length}）` : "" })}
                        </Button>
                    </div>
                </div>
            )}

            {/* Shot List Table / Cards */}
            {filteredShots.length === 0 ? (
                <Empty description={translate("comicDrama.noShotsMatchTheCurrentFilters")}>
                    <Space>
                        <Button type="primary" icon={<Sparkles className="size-4" />} onClick={openSplitModal}>
                            {translate("comicDrama.breakDownShotsWithAi")}</Button>
                        <Button icon={<Plus className="size-4" />} onClick={openCreateShot}>
                            {translate("comicDrama.addShotManually")}</Button>
                    </Space>
                </Empty>
            ) : (
                <div className="flex flex-col gap-3">
                    {filteredShots.map((shot, idx) => {
                        // 上游变更只登记影响项，不再改动镜头状态，因此「需要更新」由待确认项派生
                        const pendingUpdate = pendingImpactTargets.has(`shot:${shot.id}`);
                        const statusInfo = pendingUpdate && shot.productionStatus !== "needsUpdate"
                            ? { label: translate("comicDrama.needsUpdate"), color: "warning" }
                            : getStatusMap(translate)[shot.productionStatus] || getStatusMap(translate).draft;
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
                                            aria-label={translate("comicDrama.selectShotCount", { value0: shot.shotNumber })}
                                        />
                                        <span className="rounded bg-[var(--studio-line)] px-2 py-0.5 font-mono text-sm font-semibold text-[var(--studio-ink)]">
                                            #{shot.shotNumber}
                                        </span>
                                        <Tag color="cyan">{productionParameterLabel(shot.shotSize || "", translate) || translate("comicDrama.shotSizeNotSet")}</Tag>
                                        <Tag color="geekblue">{productionParameterLabel(shot.cameraMovement || "", translate) || translate("comicDrama.staticCamera")}</Tag>
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
                                            title={translate("comicDrama.moveUp")}
                                        />
                                        <Button
                                            size="small"
                                            type="text"
                                            disabled={idx === filteredShots.length - 1}
                                            icon={<ArrowDown className="size-3.5" />}
                                            onClick={() => handleMoveShot(idx, "down")}
                                            title={translate("comicDrama.moveDown")}
                                        />
                                        <Button
                                            size="small"
                                            icon={<Edit className="size-3.5" />}
                                            onClick={() => openEditShot(shot)}
                                        >
                                            {translate("comicDrama.edit")}</Button>
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
                                        <span className="font-medium text-[var(--studio-muted)]">{translate("comicDrama.compositionAndContent")}</span>
                                        <p className="mt-1 leading-5 text-[var(--studio-text)]">
                                            {shot.visualDescription || translate("comicDrama.noVisualDescription")}
                                        </p>
                                    </div>

                                    <div>
                                        <span className="font-medium text-[var(--studio-muted)]">{translate("comicDrama.dialogueAndSound")}</span>
                                        <p className="mt-1 leading-5 text-[var(--studio-text)]">
                                            {shot.dialogueVoiceover ? `“${shot.dialogueVoiceover}”` : translate("comicDrama.noDialogueVisualsOnly")}
                                        </p>
                                        {shot.soundDescription && (
                                            <p className="mt-0.5 text-[var(--studio-faint)]">{translate("comicDrama.soundEffectsCount_36cdc2", { value0: shot.soundDescription })}</p>
                                        )}
                                    </div>

                                    <div>
                                        <span className="font-medium text-[var(--studio-muted)]">{translate("comicDrama.lightingAndAssets")}</span>
                                        <p className="mt-1 text-[var(--studio-text)]">
                                            {shot.lightingAtmosphere || translate("comicDrama.naturalLighting")}
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
                                                            alt={translate("comicDrama.assetVersionCount", { value0: versionLabel })}
                                                            width={52}
                                                            height={52}
                                                            className="size-[52px] rounded-md border border-[var(--studio-line)] object-cover"
                                                            classNames={{ root: "overflow-hidden rounded-md" }}
                                                            title={versionLabel}
                                                        />
                                                    ) : (
                                                        <span
                                                            key={versionId}
                                                            title={translate("comicDrama.assetVersionCountHasNoGeneratedImageYet", { value0: versionLabel })}
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
                                            <span className="font-medium text-[var(--studio-muted)]">{translate("comicDrama.finalVideoPrompt")}</span>
                                            <Button
                                                size="small"
                                                type="text"
                                                icon={<Sparkles className="size-3.5" />}
                                                loading={composingPromptShotId === shot.id}
                                                disabled={composingPrompts || !pricingReady}
                                                onClick={() => void handleGenerateFinalVideoPrompt(shot)}
                                            >
                                                {finalVideoPrompt ? translate("comicDrama.regenerate") : translate("comicDrama.generateWithAi")}
                                            </Button>
                                        </div>
                                        {finalVideoPrompt ? (
                                            <Button
                                                type="text"
                                                block
                                                className="mt-1 !h-auto !p-0 text-left"
                                                aria-label={translate("comicDrama.finalVideoPromptForShotCount", { value0: shot.shotNumber })}
                                                onClick={() => openPromptDetail(shot, finalVideoPrompt)}
                                            >
                                                <span className="line-clamp-3 whitespace-normal text-left leading-5 text-[var(--studio-text)]" title={finalVideoPrompt.prompt}>
                                                    {finalVideoPrompt.prompt}
                                                </span>
                                            </Button>
                                        ) : (
                                            <p className="mt-1 leading-5 text-[var(--studio-text)]">{translate("comicDrama.notGeneratedYetUseAiToCreateAPromptFor")}</p>
                                        )}
                                        {finalVideoPrompt ? (
                                            <p className="mt-1 text-[10px] text-[var(--studio-faint)]">{translate("comicDrama.adoptedVcount_25e1ac", { value0: finalVideoPrompt.versionNumber })}</p>
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
                        <span>{translate("comicDrama.aiShotBreakdown")}</span>
                    </div>
                }
                open={splitModalOpen}
                onCancel={() => setSplitModalOpen(false)}
                footer={null}
                width={560}
            >
                <div className="flex flex-col gap-4 py-2">
                    <p className="text-xs text-[var(--studio-muted)]">
                        {translate("comicDrama.theStoryboardAgentAnalyzesTheSelectedScriptAndDialogueWith")}</p>

                    <div>
                        <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.breakdownScopeEpisode")}</label>
                        <Select
                            className="mt-1 w-full"
                            value={splitEpisodeId}
                            onChange={(val) => {
                                setSplitEpisodeId(val);
                                setSplitSceneId("");
                            }}
                            options={episodes.map((ep) => ({
                                value: ep.id,
                                label: translate("comicDrama.episodeCountCount", { value0: ep.episodeNumber, value1: ep.title || translate("comicDrama.untitled") }),
                            }))}
                        />
                    </div>

                    {splitEpisodeId && (
                        <div>
                            <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.specificSceneOptional")}</label>
                            <Select
                                className="mt-1 w-full"
                                value={splitSceneId}
                                onChange={setSplitSceneId}
                                options={[
                                    { value: "", label: translate("comicDrama.breakDownEntireEpisode") },
                                    ...(episodes.find((e) => e.id === splitEpisodeId)?.scenes || []).map((sc) => ({
                                        value: sc.id,
                                        label: translate("comicDrama.sceneCountCount", { value0: sc.sceneNumber, value1: sc.location || translate("comicDrama.locationNotSet") }),
                                    })),
                                ]}
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.estimatedShotCount")}</label>
                            {/* InputNumber 自带 90px 固定宽度且属于无层样式，普通 w-full 会被它压过，必须用 w-full! 才能撑满 */}
                            <InputNumber
                                min={1}
                                max={50}
                                className="mt-1 w-full!"
                                placeholder={translate("comicDrama.leaveBlankForAiToDecide")}
                                value={splitShotCount}
                                onChange={setSplitShotCount}
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.narrativePacing")}</label>
                            <Select
                                className="mt-1 w-full"
                                value={splitRhythm}
                                onChange={setSplitRhythm}
                                options={[
                                    { value: "紧凑利落", label: translate("comicDrama.tightAndBriskFastPacedDrama") },
                                    { value: "高潮反转", label: translate("comicDrama.climacticTwistsSuspenseAndRelease") },
                                    { value: "舒缓写意", label: translate("comicDrama.relaxedAndExpressiveEmotionalAtmosphere") },
                                    { value: "激烈打斗", label: translate("comicDrama.intenseActionRapidCuts") },
                                ]}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.creativeFocus")}</label>
                        <Input
                            className="mt-1"
                            value={splitFocus}
                            onChange={(e) => setSplitFocus(e.target.value)}
                            placeholder={translate("comicDrama.emphasizeCharacterConflictAndKeyActions")}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--studio-muted)]">{translate("comicDrama.breakdownModel")}</label>
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
                        <Button onClick={() => setSplitModalOpen(false)}>{translate("comicDrama.cancel")}</Button>
                        <Button
                            type="primary"
                            loading={splitting}
                            icon={<Sparkles className="size-4" />}
                            onClick={handleTriggerSplit}
                        >
                            {translate("comicDrama.startBreakdown")}</Button>
                    </div>
                </div>
            </Modal>

            <Modal
                title={translate("comicDrama.finalVideoPromptForShotCount", { value0: promptDetail?.shotNumber ?? "" })}
                open={Boolean(promptDetail)}
                onCancel={() => setPromptDetail(null)}
                footer={<div className="flex justify-end gap-2">
                    <Button onClick={() => setPromptDetail(null)}>{translate("comicDrama.close")}</Button>
                    <Button type="primary" loading={savingPromptDetail} onClick={() => void handleSavePromptDetail()}>{translate("comicDrama.save")}</Button>
                </div>}
                width={720}
            >
                <p className="mb-3 text-xs text-[var(--studio-muted)]">{translate("comicDrama.adoptedVcount_25e1ac", { value0: promptDetail?.prompt.versionNumber ?? "" })}</p>
                <Input.TextArea
                    value={promptDetailDraft}
                    onChange={(event) => setPromptDetailDraft(event.target.value)}
                    maxLength={16000}
                    autoSize={{ minRows: 10, maxRows: 22 }}
                    placeholder={translate("comicDrama.editTheStructuredPromptForImageOrVideoGeneration")}
                />
                <PromptReferenceInstructions version={promptDetail?.prompt} />
            </Modal>

            {/* Shot Edit / Create Drawer */}
            <Drawer
                title={editingShot ? translate("comicDrama.editShotCount", { value0: editingShot.shotNumber }) : translate("comicDrama.newShot")}
                open={shotDrawerOpen}
                onClose={() => setShotDrawerOpen(false)}
                size="large"
                extra={
                    <Button type="primary" loading={savingShot} onClick={handleSaveShot}>
                        {translate("comicDrama.save")}</Button>
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
                            label={translate("comicDrama.shotNumber")}
                            rules={[{ required: true, message: translate("comicDrama.enterAShotNumber") }]}
                        >
                            {/* InputNumber 自带 90px 固定宽度，普通 w-full 压不过它，必须用 w-full! */}
                            <InputNumber min={1} className="w-full!" />
                        </Form.Item>

                        <Form.Item
                            name="durationSeconds"
                            label={translate("comicDrama.estimatedDurationSeconds")}
                            rules={[{ required: true, message: translate("comicDrama.enterADuration") }]}
                        >
                            <InputNumber min={0.5} max={120} step={0.5} className="w-full!" />
                        </Form.Item>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="shotSize" label={translate("comicDrama.shotSize_6867f7")}>
                            <Select options={getShotSizes(translate)} />
                        </Form.Item>

                        <Form.Item name="cameraMovement" label={translate("comicDrama.cameraMovement")}>
                            <Select options={getCameraMovements(translate)} />
                        </Form.Item>
                    </div>

                    <Form.Item
                        name="visualDescription"
                        label={translate("comicDrama.compositionAndVisualDescription")}
                        rules={[{ required: true, message: translate("comicDrama.enterAVisualDescription") }]}
                    >
                        <Input.TextArea rows={3} placeholder={translate("comicDrama.characterPlacementEnvironmentalDetailsAndAction")} />
                    </Form.Item>

                    <Form.Item name="actionDescription" label={translate("comicDrama.characterAndObjectAction")}>
                        <Input placeholder={translate("comicDrama.forExampleDrawsASwordAndPointsForwardWithA")} />
                    </Form.Item>

                    <Form.Item name="dialogueVoiceover" label={translate("comicDrama.dialogueOrNarration")}>
                        <Input.TextArea rows={2} placeholder={translate("comicDrama.spokenDialogueOrVoiceOverInThisShot")} />
                    </Form.Item>

                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="lightingAtmosphere" label={translate("comicDrama.lightingWeatherAndMood")}>
                            <Input placeholder={translate("comicDrama.forExampleWarmSlantingSunlightAStormyNight")} />
                        </Form.Item>

                        <Form.Item name="soundDescription" label={translate("comicDrama.ambientSoundAndKeyEffects")}>
                            <Input placeholder={translate("comicDrama.forExampleMetallicSwordDrawRapidRain")} />
                        </Form.Item>
                    </div>

                    <Form.Item name="productionStatus" label={translate("comicDrama.productionStatus")}>
                        <Select
                            options={[
                                { value: "draft", label: translate("comicDrama.draft_61984e") },
                                { value: "ready", label: translate("comicDrama.ready_760470") },
                                { value: "completed", label: translate("comicDrama.completed_eca6cb") },
                                { value: "needsUpdate", label: translate("comicDrama.needsUpdate_66840b") },
                            ]}
                        />
                    </Form.Item>

                    {/* 提示词是独立版本记录，不参与镜头表单校验，随右上角「保存」一并提交。 */}
                    <Form.Item
                        label={translate("comicDrama.finalVideoPrompt_abd84d")}
                        extra={translate("comicDrama.finalVideoPromptIsSavedAsANewAdoptedVersionOnChange")}
                    >
                        <Input.TextArea
                            rows={6}
                            maxLength={16000}
                            value={promptDraft}
                            onChange={(event) => setPromptDraft(event.target.value)}
                            placeholder={translate("comicDrama.editTheStructuredPromptForImageOrVideoGeneration")}
                        />
                        <PromptReferenceInstructions version={promptDraftSource} />
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
