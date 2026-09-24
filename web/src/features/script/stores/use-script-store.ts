"use client";

import { create } from "zustand";

import { ServerApiError } from "@/services/api/server";
import {
    getScriptEpisode,
    getScriptProject,
    deleteScriptEpisode,
    listScriptAiDrafts,
    listScriptAnalysisReports,
    listScriptProjects,
    listScriptVersions,
    saveScriptCharacters,
    saveScriptEpisode,
    saveScriptOutline,
    saveScriptOverview,
    saveScriptWorld,
    reorderScriptEpisodes,
} from "@/services/api/script";

import { createScriptSaveScheduler } from "../services/script-save-scheduler";
import type {
    AnalysisReport,
    CharacterRelation,
    EpisodeDetail,
    MutationResult,
    OutlineSection,
    SaveStatus,
    ScriptAiDraft,
    ScriptCharacter,
    ScriptLocation,
    ScriptOverview,
    ScriptProjectDetail,
    ScriptProjectSummary,
    ScriptVersionSummary,
    StoryEvent,
    WorldItem,
    WorldSetting,
} from "../types";

type ProjectQuery = { page: number; pageSize: number; keyword?: string; stage?: string; contentType?: string };

type ScriptStore = {
    projects: ScriptProjectSummary[];
    projectTotal: number;
    project: ScriptProjectDetail | null;
    episodes: Record<string, EpisodeDetail>;
    drafts: ScriptAiDraft[];
    analysisReports: AnalysisReport[];
    versions: ScriptVersionSummary[];
    aiTarget: { targetType: string; targetId?: string; label: string } | null;
    loading: boolean;
    error: string;
    saveStatus: SaveStatus;
    saveError: string;
    loadProjects: (query: ProjectQuery) => Promise<void>;
    loadProject: (projectId: string) => Promise<void>;
    reloadProject: () => Promise<void>;
    loadEpisode: (episodeId: string) => Promise<EpisodeDetail>;
    loadSupportingData: () => Promise<void>;
    updateOverview: (overview: ScriptOverview) => void;
    updateOutline: (sections: OutlineSection[], events: StoryEvent[]) => void;
    updateCharacters: (characters: ScriptCharacter[], relations: CharacterRelation[]) => void;
    updateWorld: (worldSetting: WorldSetting, worldItems: WorldItem[], locations: ScriptLocation[]) => void;
    updateEpisode: (detail: EpisodeDetail) => void;
    reorderEpisodes: (episodeIds: string[]) => void;
    deleteEpisode: (episodeId: string) => Promise<void>;
    setAiTarget: (target: { targetType: string; targetId?: string; label: string } | null) => void;
    replaceDrafts: (drafts: ScriptAiDraft[]) => void;
    replaceAnalysisReports: (reports: AnalysisReport[]) => void;
    replaceVersions: (versions: ScriptVersionSummary[]) => void;
    retrySave: () => void;
    reset: () => void;
};

type ScriptStoreReference = {
    setState: (partial: Partial<ScriptStore> | ((state: ScriptStore) => Partial<ScriptStore>)) => void;
};

let storeReference: ScriptStoreReference;
let projectLoadGeneration = 0;
let projectListLoadGeneration = 0;
const episodeLoadRequests = new Map<string, Promise<EpisodeDetail>>();

const saveScheduler = createScriptSaveScheduler({
    delayMilliseconds: 600,
    isConflict: (error) => error instanceof ServerApiError && (error.status === 409 || error.code === 4004),
    onStatusChange: (status, error) => {
        storeReference.setState({
            saveStatus: status,
            saveError: error instanceof Error ? error.message : error ? String(error) : "",
        });
    },
});

function applyMutation(projectId: string, result: MutationResult) {
    storeReference.setState((state) => state.project?.id === projectId ? {
        project: {
            ...state.project,
            revision: result.revision,
            stage: result.stage,
            completionRate: result.completionRate,
            updatedAt: result.updatedAt,
        },
    } : {});
}

export const useScriptStore = create<ScriptStore>()((set, get) => ({
    projects: [],
    projectTotal: 0,
    project: null,
    episodes: {},
    drafts: [],
    analysisReports: [],
    versions: [],
    aiTarget: null,
    loading: false,
    error: "",
    saveStatus: "idle",
    saveError: "",
    loadProjects: async (query) => {
        const loadGeneration = ++projectListLoadGeneration;
        set({ loading: true, error: "" });
        try {
            const result = await listScriptProjects(query);
            if (loadGeneration === projectListLoadGeneration) {
                set({ projects: result.projects, projectTotal: result.total, loading: false });
            }
        } catch (error) {
            if (loadGeneration !== projectListLoadGeneration) return;
            const message = error instanceof Error ? error.message : "加载剧本项目失败";
            set({ loading: false, error: error instanceof ServerApiError && error.status === 403 ? `403：${message}` : message });
        }
    },
    loadProject: async (projectId) => {
        const loadGeneration = ++projectLoadGeneration;
        saveScheduler.reset();
        set({ project: null, loading: true, error: "", saveStatus: "idle", saveError: "", episodes: {}, drafts: [], analysisReports: [], versions: [], aiTarget: null });
        try {
            const project = await getScriptProject(projectId);
            if (loadGeneration === projectLoadGeneration) set({ project, loading: false });
        } catch (error) {
            if (loadGeneration === projectLoadGeneration) {
                set({ loading: false, error: error instanceof Error ? error.message : "加载剧本失败" });
                throw error;
            }
        }
    },
    reloadProject: async () => {
        const projectId = get().project?.id;
        if (!projectId) return;
        try {
            await get().loadProject(projectId);
            if (get().project?.id === projectId) await get().loadSupportingData();
        } finally {
            saveScheduler.resume();
        }
    },
    loadEpisode: async (episodeId) => {
        const cached = get().episodes[episodeId];
        if (cached) return cached;
        const projectId = get().project?.id;
        if (!projectId) throw new Error("剧本项目尚未加载");
        const loadGeneration = projectLoadGeneration;
        const requestKey = `${loadGeneration}:${episodeId}`;
        const pendingRequest = episodeLoadRequests.get(requestKey);
        if (pendingRequest) return pendingRequest;
        const request = getScriptEpisode(projectId, episodeId).then((detail) => {
            if (projectLoadGeneration !== loadGeneration || get().project?.id !== projectId) throw new Error("剧本项目已经切换，请重新打开分集");
            set((state) => ({ episodes: { ...state.episodes, [episodeId]: detail } }));
            return detail;
        }).finally(() => { episodeLoadRequests.delete(requestKey); });
        episodeLoadRequests.set(requestKey, request);
        return request;
    },
    loadSupportingData: async () => {
        const projectId = get().project?.id;
        if (!projectId) return;
        try {
            const [drafts, analysisReports, versions] = await Promise.all([
                listScriptAiDrafts(projectId),
                listScriptAnalysisReports(projectId),
                listScriptVersions(projectId),
            ]);
            if (get().project?.id === projectId) set({ drafts, analysisReports, versions, error: "" });
        } catch (error) {
            if (get().project?.id === projectId) {
                const message = error instanceof Error ? error.message : "未知错误";
                set({ error: `剧本辅助数据加载失败：${message}` });
            }
            throw error;
        }
    },
    updateOverview: (overview) => {
        const current = get().project;
        // 内容没变就不回写：后端会把概览保存当作全项目粒度的上游变更，空回写会让漫剧所有已采用的提示词失效
        if (current && JSON.stringify(current.overview) === JSON.stringify(overview)) {
            return;
        }
        const saveGeneration = projectLoadGeneration;
        set((state) => state.project ? { project: { ...state.project, overview } } : {});
        saveScheduler.schedule("overview", async () => {
            const project = get().project;
            if (!project || saveGeneration !== projectLoadGeneration) return;
            const result = await saveScriptOverview(project.id, project.revision, project.overview);
            if (saveGeneration === projectLoadGeneration) applyMutation(project.id, result);
        });
    },
    updateOutline: (outlineSections, storyEvents) => {
        const current = get().project;
        // 同理：大纲属于全项目粒度的上游，空回写会把漫剧所有已采用的提示词标成需要更新
        if (current && JSON.stringify(current.outlineSections) === JSON.stringify(outlineSections)
                && JSON.stringify(current.storyEvents) === JSON.stringify(storyEvents)) {
            return;
        }
        const saveGeneration = projectLoadGeneration;
        set((state) => state.project ? { project: { ...state.project, outlineSections, storyEvents } } : {});
        saveScheduler.schedule("outline", async () => {
            const project = get().project;
            if (!project || saveGeneration !== projectLoadGeneration) return;
            const result = await saveScriptOutline(project.id, project.revision, project.outlineSections, project.storyEvents);
            if (saveGeneration === projectLoadGeneration) applyMutation(project.id, result);
        });
    },
    updateCharacters: (characters, characterRelations) => {
        const saveGeneration = projectLoadGeneration;
        set((state) => state.project ? { project: { ...state.project, characters, characterRelations } } : {});
        saveScheduler.schedule("characters", async () => {
            const project = get().project;
            if (!project || saveGeneration !== projectLoadGeneration) return;
            const result = await saveScriptCharacters(project.id, project.revision, project.characters, project.characterRelations);
            if (saveGeneration === projectLoadGeneration) applyMutation(project.id, result);
        });
    },
    updateWorld: (worldSetting, worldItems, locations) => {
        const saveGeneration = projectLoadGeneration;
        set((state) => state.project ? { project: { ...state.project, worldSetting, worldItems, locations } } : {});
        saveScheduler.schedule("world", async () => {
            const project = get().project;
            if (!project || saveGeneration !== projectLoadGeneration) return;
            const result = await saveScriptWorld(project.id, project.revision, project.worldSetting, project.worldItems, project.locations);
            if (saveGeneration === projectLoadGeneration) applyMutation(project.id, result);
        });
    },
    updateEpisode: (detail) => {
        const saveGeneration = projectLoadGeneration;
        set((state) => ({
            episodes: { ...state.episodes, [detail.episode.id]: detail },
            project: state.project ? {
                ...state.project,
                episodes: state.project.episodes.some((episode) => episode.id === detail.episode.id)
                    ? state.project.episodes.map((episode) => episode.id === detail.episode.id ? detail.episode : episode)
                    : [...state.project.episodes, detail.episode],
            } : null,
        }));
        saveScheduler.schedule(`episode:${detail.episode.id}`, async () => {
            const project = get().project;
            const latest = get().episodes[detail.episode.id];
            if (!project || !latest || saveGeneration !== projectLoadGeneration) return;
            const result = await saveScriptEpisode(project.id, project.revision, latest);
            if (saveGeneration === projectLoadGeneration) applyMutation(project.id, result);
        });
    },
    reorderEpisodes: (episodeIds) => {
        const saveGeneration = projectLoadGeneration;
        set((state) => state.project ? {
            project: {
                ...state.project,
                episodes: episodeIds.map((id, index) => {
                    const episode = state.project!.episodes.find((item) => item.id === id)!;
                    return { ...episode, episodeNumber: index + 1, sortOrder: index };
                }),
            },
        } : {});
        saveScheduler.schedule("episode-order", async () => {
            const project = get().project;
            if (!project || saveGeneration !== projectLoadGeneration) return;
            const result = await reorderScriptEpisodes(project.id, project.revision, project.episodes.map((episode) => episode.id));
            if (saveGeneration === projectLoadGeneration) applyMutation(project.id, result);
        });
    },
    deleteEpisode: async (episodeId) => {
        const project = get().project;
        if (!project) return;
        if (get().saveStatus !== "saved" && get().saveStatus !== "idle") {
            throw new Error("请等待当前修改保存完成后再删除分集");
        }
        const result = await deleteScriptEpisode(project.id, project.revision, episodeId);
        applyMutation(project.id, result);
        try {
            await get().reloadProject();
        } catch {
            throw new Error("分集已删除，但重新加载项目失败，请刷新页面查看最新内容");
        }
    },
    setAiTarget: (aiTarget) => set({ aiTarget }),
    replaceDrafts: (drafts) => set({ drafts }),
    replaceAnalysisReports: (analysisReports) => set({ analysisReports }),
    replaceVersions: (versions) => set({ versions }),
    retrySave: () => saveScheduler.retry(),
    reset: () => {
        projectLoadGeneration += 1;
        projectListLoadGeneration += 1;
        saveScheduler.reset();
        set({ projects: [], projectTotal: 0, project: null, episodes: {}, drafts: [], analysisReports: [], versions: [], aiTarget: null, loading: false, error: "", saveStatus: "idle", saveError: "" });
    },
}));

storeReference = useScriptStore;
