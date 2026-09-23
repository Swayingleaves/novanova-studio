"use client";

import { create } from "zustand";

import {
    adoptComicDramaMedia,
    bindComicDramaCanvas,
    checkComicDramaContinuity,
    composeComicDramaPrompt,
    confirmComicDramaShotDraft,
    confirmComicDramaUpdate,
    createComicDramaBatchTask,
    createComicDramaGenerationTask,
    deleteComicDramaShot,
    deleteComicDramaTextTrack,
    deleteComicDramaTimelineText,
    discardComicDramaShotDraft,
    generateComicDramaShotDraft,
    getComicDramaWorkspace,
    listComicDramaMedia,
    reorderComicDramaShots,
    reorderComicDramaTimelineTexts,
    saveComicDramaAsset,
    saveComicDramaAssetVersion,
    saveComicDramaPrompt,
    saveComicDramaShot,
    saveComicDramaTimelineText,
    saveComicDramaVoiceTrack,
    updateComicDramaSettings,
    updateComicDramaShotDraft,
} from "@/services/api/comic-drama";
import type {
    ComicDramaAsset,
    ComicDramaAssetInput,
    ComicDramaAssetVersion,
    ComicDramaAssetVersionInput,
    ComicDramaBatchTask,
    ComicDramaContinuityIssue,
    ComicDramaMediaResult,
    ComicDramaMutationResult,
    ComicDramaPromptVersion,
    ComicDramaSettings,
    ComicDramaShot,
    ComicDramaShotDraft,
    ComicDramaShotInput,
    ComicDramaTimelineText,
    ComicDramaTimelineTextInput,
    ComicDramaStage,
    ComicDramaVoiceTrack,
    ComicDramaVoiceTrackInput,
    ComicDramaWorkspace,
} from "../types";

type ComicDramaState = {
    workspace: ComicDramaWorkspace | null;
    loading: boolean;
    error: string;
    refreshing: boolean;
    activeStage: ComicDramaStage;
    pendingStage: ComicDramaStage | null;
    selectedShotId: string | null;
    selectedAssetId: string | null;
    selectedEpisodeId: string | null;
    selectedSceneId: string | null;
    /** 待生成信号：其他阶段点「生成」时写入，媒体生成中心消费后清空。 */
    pendingGeneration: { shotId: string; mediaType: "image" | "video" } | null;
    pendingTimelineTexts: Record<string, ComicDramaTimelineTextInput>;
    pendingTimelineTextReorderIds: string[];
    pendingTimelineVoices: Record<string, ComicDramaVoiceTrackInput>;
    timelineSaving: boolean;
    timelineSaveError: string;

    loadWorkspace: (projectId: string) => Promise<void>;
    reloadWorkspace: () => Promise<void>;
    setActiveStage: (stage: ComicDramaStage) => void;
    clearPendingStage: () => void;
    setSelectedShotId: (id: string | null) => void;
    setSelectedAssetId: (id: string | null) => void;
    setSelectedEpisodeId: (id: string | null) => void;
    setSelectedSceneId: (id: string | null) => void;
    /** 切到媒体生成中心并对指定镜头发起生成。 */
    requestShotGeneration: (shotId: string, mediaType: "image" | "video") => void;
    /** 清空待生成镜头信号。 */
    clearPendingGeneration: () => void;

    updateSettings: (settings: ComicDramaSettings) => Promise<ComicDramaMutationResult>;
    saveAsset: (asset: ComicDramaAssetInput) => Promise<ComicDramaAsset>;
    saveAssetVersion: (version: ComicDramaAssetVersionInput) => Promise<ComicDramaAssetVersion>;
    generateShotDraft: (input: {
        episodeId?: string;
        sceneId?: string;
        shotCount: number;
        rhythm: string;
        focus: string;
        model: string;
    }) => Promise<ComicDramaShotDraft>;
    confirmShotDraft: (draftId: string) => Promise<ComicDramaMutationResult>;
    updateShotDraft: (draftId: string, draftData: Record<string, unknown>) => Promise<ComicDramaShotDraft>;
    discardShotDraft: (draftId: string) => Promise<ComicDramaMutationResult>;
    saveShot: (shot: ComicDramaShotInput) => Promise<ComicDramaShot>;
    reorderShots: (shotIds: string[]) => Promise<void>;
    deleteShot: (shotId: string, confirm: boolean) => Promise<ComicDramaMutationResult>;
    composePrompt: (shotId: string, model: string) => Promise<ComicDramaPromptVersion>;
    savePrompt: (shotId: string, prompt: string, expectedPromptVersion?: number) => Promise<ComicDramaPromptVersion>;
    /** AI 合成并立即采用为后续视频生成所使用的最终提示词。 */
    generateFinalVideoPrompt: (shotId: string, model: string) => Promise<ComicDramaPromptVersion>;
    createGenerationTask: (input: {
        targetType: string;
        targetIds: string[];
        model: string;
        settings: Record<string, unknown>;
    }) => Promise<{ mediaResults: ComicDramaMediaResult[]; taskCount: number }>;
    adoptMedia: (mediaId: string) => Promise<ComicDramaMutationResult>;
    confirmUpdate: (scope: string, targetId: string, resolution: "keepOld" | "update") => Promise<ComicDramaMutationResult>;
    saveVoiceTrack: (voiceTrack: ComicDramaVoiceTrackInput) => Promise<ComicDramaVoiceTrack>;
    saveTimelineText: (timelineText: ComicDramaTimelineTextInput) => Promise<ComicDramaTimelineText>;
    deleteTimelineText: (timelineTextId: string) => Promise<void>;
    deleteTextTrack: (trackNumber: number) => Promise<void>;
    queueTimelineText: (timelineText: ComicDramaTimelineTextInput) => void;
    queueTimelineTextReorder: (timelineTexts: ComicDramaTimelineTextInput[]) => void;
    queueTimelineVoice: (voiceTrack: ComicDramaVoiceTrackInput) => void;
    clearPendingTimelineText: (timelineTextId: string) => void;
    clearPendingTimelineVoice: (voiceTrackId: string) => void;
    discardPendingTimelineChanges: () => void;
    savePendingTimelineChanges: () => Promise<boolean>;
    createBatchTask: (input: {
        scope: string;
        targetIds: string[];
        taskType: string;
        model: string;
        settings: Record<string, unknown>;
    }) => Promise<ComicDramaBatchTask>;
    bindCanvas: (input: {
        canvasProjectId: string;
        entityType: string;
        entityId: string;
        nodeId: string;
    }) => Promise<void>;
    checkContinuity: () => Promise<ComicDramaContinuityIssue[]>;
    syncMedia: () => Promise<void>;
    reset: () => void;
};

/**
 * 用最新媒体记录重算依赖媒体的产出统计。
 * 口径与后端 ComicDramaService.getWorkspace 保持一致，后端改动时这里需同步。
 *
 * @param workspace 当前工作区
 * @param media 最新媒体记录
 * @returns 已刷新媒体与统计的工作区
 */
function withRefreshedMediaProgress(workspace: ComicDramaWorkspace, media: ComicDramaMediaResult[]): ComicDramaWorkspace {
    const progress = workspace.productionProgress;
    const completedShotCount = workspace.shots.filter((shot) =>
        media.some((item) => item.targetType === "shot" && item.targetId === shot.id && item.adopted && item.status === "completed")
    ).length;
    const runningTaskCount = media.filter((item) => item.status === "queued" || item.status === "processing").length;
    const productionUnits = progress.assetCount + progress.shotCount;
    return {
        ...workspace,
        media,
        // 与后端一样取整除，避免轮询后百分比出现小数抖动
        completionRate: productionUnits === 0 ? 0 : Math.floor((progress.readyAssetCount + completedShotCount) * 100 / productionUnits),
        productionProgress: { ...progress, completedShotCount, runningTaskCount },
    };
}

let timelineSavePromise: Promise<boolean> | null = null;

export const useComicDramaStore = create<ComicDramaState>((set, get) => ({
    workspace: null,
    loading: false,
    error: "",
    refreshing: false,
    activeStage: "readiness",
    pendingStage: null,
    selectedShotId: null,
    selectedAssetId: null,
    selectedEpisodeId: null,
    selectedSceneId: null,
    pendingGeneration: null,
    pendingTimelineTexts: {},
    pendingTimelineTextReorderIds: [],
    pendingTimelineVoices: {},
    timelineSaving: false,
    timelineSaveError: "",

    loadWorkspace: async (projectId: string) => {
        set({ loading: true, error: "" });
        try {
            const workspace = await getComicDramaWorkspace(projectId);
            const projectChanged = get().workspace?.projectId !== workspace.projectId;
            set({
                workspace,
                loading: false,
                ...(projectChanged ? { pendingTimelineTexts: {}, pendingTimelineTextReorderIds: [], pendingTimelineVoices: {}, timelineSaveError: "" } : {}),
                // If shots already exist, default to shots stage, otherwise readiness
                activeStage: workspace.shots.length > 0 ? "shots" : workspace.readiness.ready ? "settings" : "readiness",
                pendingStage: null,
                selectedEpisodeId: workspace.scriptProject.episodes[0]?.id || null,
            });
        } catch (requestError) {
            set({
                loading: false,
                error: requestError instanceof Error ? requestError.message : "加载漫剧工作区失败",
            });
        }
    },

    reloadWorkspace: async () => {
        const current = get().workspace;
        if (!current) return;
        set({ refreshing: true });
        try {
            const workspace = await getComicDramaWorkspace(current.projectId);
            set({ workspace, refreshing: false });
        } catch (requestError) {
            set({
                refreshing: false,
                error: requestError instanceof Error ? requestError.message : "刷新工作区失败",
            });
        }
    },

    setActiveStage: (activeStage) => set((state) => state.activeStage === "storyboard" && activeStage !== "storyboard"
        && (Object.keys(state.pendingTimelineTexts).length > 0 || Object.keys(state.pendingTimelineVoices).length > 0)
        ? { pendingStage: activeStage }
        : { activeStage, pendingStage: null }),
    clearPendingStage: () => set({ pendingStage: null }),
    setSelectedShotId: (selectedShotId) => set({ selectedShotId }),
    setSelectedAssetId: (selectedAssetId) => set({ selectedAssetId }),
    setSelectedEpisodeId: (selectedEpisodeId) => set({ selectedEpisodeId }),
    setSelectedSceneId: (selectedSceneId) => set({ selectedSceneId }),

    requestShotGeneration: (shotId, mediaType) => set({
        selectedShotId: shotId,
        pendingGeneration: { shotId, mediaType },
        activeStage: "media",
    }),

    clearPendingGeneration: () => set({ pendingGeneration: null }),

    updateSettings: async (settings) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const result = await updateComicDramaSettings(workspace.projectId, workspace.revision, settings);
        await get().reloadWorkspace();
        return result;
    },

    saveAsset: async (asset) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const saved = await saveComicDramaAsset(workspace.projectId, workspace.revision, asset);
        await get().reloadWorkspace();
        return saved;
    },

    saveAssetVersion: async (version) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const saved = await saveComicDramaAssetVersion(workspace.projectId, workspace.revision, version);
        await get().reloadWorkspace();
        return saved;
    },

    generateShotDraft: async (input) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const draft = await generateComicDramaShotDraft({
            projectId: workspace.projectId,
            ...input,
            confirmed: true,
        });
        await get().reloadWorkspace();
        return draft;
    },

    confirmShotDraft: async (draftId) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const result = await confirmComicDramaShotDraft(workspace.projectId, workspace.revision, draftId);
        await get().reloadWorkspace();
        return result;
    },

    updateShotDraft: async (draftId, draftData) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const updated = await updateComicDramaShotDraft(workspace.projectId, workspace.revision, draftId, draftData);
        await get().reloadWorkspace();
        return updated;
    },

    discardShotDraft: async (draftId) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const result = await discardComicDramaShotDraft(workspace.projectId, workspace.revision, draftId);
        await get().reloadWorkspace();
        return result;
    },

    saveShot: async (shot) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const saved = await saveComicDramaShot(workspace.projectId, workspace.revision, shot);
        await get().reloadWorkspace();
        return saved;
    },

    reorderShots: async (shotIds) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        await reorderComicDramaShots(workspace.projectId, workspace.revision, shotIds);
        await get().reloadWorkspace();
    },

    deleteShot: async (shotId, confirm) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const result = await deleteComicDramaShot(workspace.projectId, workspace.revision, shotId, confirm);
        await get().reloadWorkspace();
        return result;
    },

    composePrompt: async (shotId, model) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const prompt = await composeComicDramaPrompt(workspace.projectId, shotId, model, true);
        await get().reloadWorkspace();
        return prompt;
    },

    savePrompt: async (shotId, prompt, expectedPromptVersion) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const saved = await saveComicDramaPrompt(workspace.projectId, workspace.revision, shotId, prompt, expectedPromptVersion);
        await get().reloadWorkspace();
        return saved;
    },

    // AI 合成结果先保留原始版本，再采用同一文本，确保视频生成读取到的就是界面展示的最终提示词。
    generateFinalVideoPrompt: async (shotId, model) => {
        const composed = await get().composePrompt(shotId, model);
        return get().savePrompt(shotId, composed.prompt, composed.versionNumber);
    },

    createGenerationTask: async (input) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const result = await createComicDramaGenerationTask({
            projectId: workspace.projectId,
            expectedRevision: workspace.revision,
            ...input,
            confirmed: true,
        });
        await get().reloadWorkspace();
        return result;
    },

    adoptMedia: async (mediaId) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const result = await adoptComicDramaMedia(workspace.projectId, workspace.revision, mediaId);
        await get().reloadWorkspace();
        return result;
    },

    confirmUpdate: async (scope, targetId, resolution) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const result = await confirmComicDramaUpdate(workspace.projectId, workspace.revision, scope, targetId, resolution, true);
        await get().reloadWorkspace();
        return result;
    },

    saveVoiceTrack: async (voiceTrack) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const saved = await saveComicDramaVoiceTrack(workspace.projectId, workspace.revision, voiceTrack);
        await get().reloadWorkspace();
        return saved;
    },

    saveTimelineText: async (timelineText) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const saved = await saveComicDramaTimelineText(workspace.projectId, workspace.revision, timelineText);
        await get().reloadWorkspace();
        return saved;
    },

    deleteTimelineText: async (timelineTextId) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        await deleteComicDramaTimelineText(workspace.projectId, workspace.revision, timelineTextId);
        await get().reloadWorkspace();
    },

    deleteTextTrack: async (trackNumber) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        await deleteComicDramaTextTrack(workspace.projectId, workspace.revision, trackNumber);
        await get().reloadWorkspace();
    },

    queueTimelineText: (timelineText) => set((state) => ({
        pendingTimelineTexts: { ...state.pendingTimelineTexts, [timelineText.id]: timelineText },
        timelineSaveError: "",
    })),

    queueTimelineTextReorder: (timelineTexts) => set((state) => ({
        pendingTimelineTexts: { ...state.pendingTimelineTexts, ...Object.fromEntries(timelineTexts.map((item) => [item.id, item])) },
        pendingTimelineTextReorderIds: [...new Set([...state.pendingTimelineTextReorderIds, ...timelineTexts.map((item) => item.id)])],
        timelineSaveError: "",
    })),

    queueTimelineVoice: (voiceTrack) => set((state) => ({
        pendingTimelineVoices: { ...state.pendingTimelineVoices, [voiceTrack.id]: voiceTrack },
        timelineSaveError: "",
    })),

    clearPendingTimelineText: (timelineTextId) => set((state) => {
        const pendingTimelineTexts = { ...state.pendingTimelineTexts };
        delete pendingTimelineTexts[timelineTextId];
        return { pendingTimelineTexts, pendingTimelineTextReorderIds: state.pendingTimelineTextReorderIds.filter((id) => id !== timelineTextId) };
    }),

    clearPendingTimelineVoice: (voiceTrackId) => set((state) => {
        const pendingTimelineVoices = { ...state.pendingTimelineVoices };
        delete pendingTimelineVoices[voiceTrackId];
        return { pendingTimelineVoices };
    }),

    discardPendingTimelineChanges: () => set({ pendingTimelineTexts: {}, pendingTimelineTextReorderIds: [], pendingTimelineVoices: {}, timelineSaveError: "" }),

    savePendingTimelineChanges: () => {
        if (timelineSavePromise) return timelineSavePromise;
        timelineSavePromise = Promise.resolve().then(async () => {
            set({ timelineSaving: true, timelineSaveError: "" });
            const workspace = get().workspace;
            if (!workspace) {
                set({ timelineSaving: false, timelineSaveError: "工作区未初始化" });
                timelineSavePromise = null;
                return false;
            }
            let expectedRevision = workspace.revision;
            let savedAny = false;
            const applySavedItems = (texts: ComicDramaTimelineText[] = [], voice?: ComicDramaVoiceTrack) => {
                expectedRevision += 1;
                savedAny = true;
                const textIds = new Set(texts.map((item) => item.id));
                // 保存响应已经包含最新片段，直接更新工作区，避免每项保存后重取完整数据。
                set((state) => state.workspace && state.workspace.projectId === workspace.projectId ? { workspace: {
                    ...state.workspace,
                    revision: expectedRevision,
                    timelineTexts: texts.length ? [...state.workspace.timelineTexts.filter((item) => !textIds.has(item.id)), ...texts] : state.workspace.timelineTexts,
                    voiceTracks: voice ? [...state.workspace.voiceTracks.filter((item) => item.id !== voice.id), voice] : state.workspace.voiceTracks,
                    textTrackCount: texts.length ? Math.max(state.workspace.textTrackCount, ...texts.map((item) => item.trackNumber + 1)) : state.workspace.textTrackCount,
                } } : state);
            };
            try {
                if (get().pendingTimelineTextReorderIds.length) {
                    const reorderIds = get().pendingTimelineTextReorderIds;
                    const drafts = reorderIds.map((id) => get().pendingTimelineTexts[id]);
                    const saved = await reorderComicDramaTimelineTexts(workspace.projectId, expectedRevision, drafts);
                    applySavedItems(saved);
                    const savedRevisions = new Map(saved.map((item) => [item.id, item.revision]));
                    set((state) => {
                        const pendingTimelineTexts = { ...state.pendingTimelineTexts };
                        for (const draft of drafts) {
                            if (pendingTimelineTexts[draft.id] === draft) delete pendingTimelineTexts[draft.id];
                            else if (pendingTimelineTexts[draft.id]) pendingTimelineTexts[draft.id] = { ...pendingTimelineTexts[draft.id], revision: savedRevisions.get(draft.id) ?? pendingTimelineTexts[draft.id].revision };
                        }
                        return { pendingTimelineTexts, pendingTimelineTextReorderIds: state.pendingTimelineTextReorderIds.filter((id) => {
                            const submitted = drafts.find((draft) => draft.id === id);
                            return !submitted || state.pendingTimelineTexts[id] !== submitted;
                        }) };
                    });
                }
                // 同一片段只保存最后一次拖动结果；逐条推进项目修订号，沿用保存响应更新工作区。
                for (const [id, draft] of Object.entries(get().pendingTimelineTexts)) {
                    if (get().pendingTimelineTexts[id] !== draft) continue;
                    const saved = await saveComicDramaTimelineText(workspace.projectId, expectedRevision, draft);
                    applySavedItems([saved]);
                    set((state) => {
                        const current = state.pendingTimelineTexts[id];
                        if (!current) return state;
                        const pendingTimelineTexts = { ...state.pendingTimelineTexts };
                        if (current === draft) delete pendingTimelineTexts[id];
                        else pendingTimelineTexts[id] = { ...current, revision: saved.revision };
                        return { pendingTimelineTexts };
                    });
                }
                for (const [id, draft] of Object.entries(get().pendingTimelineVoices)) {
                    if (get().pendingTimelineVoices[id] !== draft) continue;
                    const saved = await saveComicDramaVoiceTrack(workspace.projectId, expectedRevision, draft);
                    applySavedItems([], saved);
                    set((state) => {
                        const current = state.pendingTimelineVoices[id];
                        if (!current) return state;
                        const pendingTimelineVoices = { ...state.pendingTimelineVoices };
                        if (current === draft) delete pendingTimelineVoices[id];
                        else pendingTimelineVoices[id] = { ...current, revision: saved.revision };
                        return { pendingTimelineVoices };
                    });
                }
                return Object.keys(get().pendingTimelineTexts).length === 0 && Object.keys(get().pendingTimelineVoices).length === 0;
            } catch (error) {
                if (savedAny) await get().reloadWorkspace();
                set({ timelineSaveError: error instanceof Error ? error.message : "时间轴保存失败" });
                return false;
            } finally {
                set({ timelineSaving: false });
                timelineSavePromise = null;
            }
        });
        return timelineSavePromise;
    },

    createBatchTask: async (input) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        const result = await createComicDramaBatchTask({
            projectId: workspace.projectId,
            expectedRevision: workspace.revision,
            ...input,
            confirmed: true,
        });
        await get().reloadWorkspace();
        return result;
    },

    bindCanvas: async (input) => {
        const workspace = get().workspace;
        if (!workspace) throw new Error("工作区未初始化");
        await bindComicDramaCanvas({
            projectId: workspace.projectId,
            expectedRevision: workspace.revision,
            ...input,
        });
        await get().reloadWorkspace();
    },

    checkContinuity: async () => {
        const workspace = get().workspace;
        if (!workspace) return [];
        const issues = await checkComicDramaContinuity(workspace.projectId);
        set((state) => state.workspace ? { workspace: { ...state.workspace, continuityIssues: issues } } : state);
        return issues;
    },

    syncMedia: async () => {
        const workspace = get().workspace;
        if (!workspace) return;
        const media = await listComicDramaMedia(workspace.projectId);
        set((state) => state.workspace ? { workspace: withRefreshedMediaProgress(state.workspace, media) } : state);
    },

    reset: () => set({
        workspace: null,
        loading: false,
        error: "",
        refreshing: false,
        activeStage: "readiness",
        pendingStage: null,
        selectedShotId: null,
        selectedAssetId: null,
        selectedEpisodeId: null,
        selectedSceneId: null,
        pendingGeneration: null,
        pendingTimelineTexts: {},
        pendingTimelineTextReorderIds: [],
        pendingTimelineVoices: {},
        timelineSaving: false,
        timelineSaveError: "",
    }),
}));
