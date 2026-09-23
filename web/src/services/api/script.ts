"use client";

import { serverGet, serverPost } from "./server";
import type {
    AnalysisReport,
    CharacterRelation,
    EpisodeDetail,
    MutationResult,
    OutlineSection,
    ProductionReadiness,
    ScriptAiDraft,
    ScriptCharacter,
    ScriptLocation,
    ScriptOverview,
    ScriptProjectDetail,
    ScriptProjectList,
    ScriptTemplate,
    ScriptVersionDetail,
    ScriptVersionSummary,
    StoryEvent,
    WorldItem,
    WorldSetting,
} from "@/features/script/types";

const SCRIPT_PATH = "/script";

export function listScriptProjects(params: { page: number; pageSize: number; keyword?: string; stage?: string; contentType?: string }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.keyword) query.set("keyword", params.keyword);
    if (params.stage) query.set("stage", params.stage);
    if (params.contentType) query.set("contentType", params.contentType);
    return serverGet<ScriptProjectList>(`${SCRIPT_PATH}/listProjects?${query}`);
}

export function listScriptTemplates() {
    return serverGet<ScriptTemplate[]>(`${SCRIPT_PATH}/listTemplates`);
}

export function createScriptProject(input: { title: string; templateKey?: string; contentType: string; logline?: string }) {
    return serverPost<ScriptProjectDetail>(`${SCRIPT_PATH}/createProject`, input);
}

export function getScriptProject(projectId: string) {
    return serverPost<ScriptProjectDetail>(`${SCRIPT_PATH}/getProject`, { projectId });
}

export function deleteScriptProjects(projects: Array<{ projectId: string; expectedRevision: number }>) {
    return serverPost<Array<{ projectId: string; revision: number; updatedAt: string }>>(`${SCRIPT_PATH}/deleteProjects`, { projects });
}

export function saveScriptOverview(projectId: string, expectedRevision: number, overview: ScriptOverview) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveOverview`, { projectId, expectedRevision, overview });
}

export function saveScriptOutline(projectId: string, expectedRevision: number, sections: OutlineSection[], events: StoryEvent[]) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveOutline`, { projectId, expectedRevision, sections, events });
}

export function saveScriptCharacters(projectId: string, expectedRevision: number, characters: ScriptCharacter[], relations: CharacterRelation[]) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveCharacters`, { projectId, expectedRevision, characters, relations });
}

export function saveScriptWorld(projectId: string, expectedRevision: number, worldSetting: WorldSetting, worldItems: WorldItem[], locations: ScriptLocation[]) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveWorld`, { projectId, expectedRevision, worldSetting, worldItems, locations });
}

export function getScriptEpisode(projectId: string, episodeId: string) {
    return serverPost<EpisodeDetail>(`${SCRIPT_PATH}/getEpisode`, { projectId, episodeId });
}

export function saveScriptEpisode(projectId: string, expectedRevision: number, episodeDetail: EpisodeDetail) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/saveEpisode`, { projectId, expectedRevision, episodeDetail });
}

export function reorderScriptEpisodes(projectId: string, expectedRevision: number, episodeIds: string[]) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/reorderEpisodes`, { projectId, expectedRevision, episodeIds });
}

export function deleteScriptEpisode(projectId: string, expectedRevision: number, episodeId: string) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/deleteEpisode`, { projectId, expectedRevision, episodeId });
}

export function generateScriptDraft(input: { projectId: string; expectedRevision: number; actionType: string; targetType: string; targetId?: string; instruction?: string; model: string }) {
    return serverPost<ScriptAiDraft>(`${SCRIPT_PATH}/generateDraft`, input);
}

export function listScriptAiDrafts(projectId: string) {
    return serverGet<ScriptAiDraft[]>(`${SCRIPT_PATH}/listAiDrafts?projectId=${encodeURIComponent(projectId)}`);
}

export function applyScriptAiDraft(input: { projectId: string; expectedRevision: number; draftId: string; draftData: Record<string, unknown> }) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/applyAiDraft`, input);
}

export function discardScriptAiDraft(projectId: string, expectedRevision: number, draftId: string) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/discardAiDraft`, { projectId, expectedRevision, draftId });
}

export function analyzeScript(input: { projectId: string; expectedRevision: number; scopeType: "project" | "episode"; scopeId?: string; instruction?: string; model: string }) {
    return serverPost<AnalysisReport>(`${SCRIPT_PATH}/analyzeScript`, input);
}

export function listScriptAnalysisReports(projectId: string) {
    return serverGet<AnalysisReport[]>(`${SCRIPT_PATH}/listAnalysisReports?projectId=${encodeURIComponent(projectId)}`);
}

export function getScriptAnalysisReport(projectId: string, reportId: string) {
    const query = new URLSearchParams({ projectId, reportId });
    return serverGet<AnalysisReport>(`${SCRIPT_PATH}/getAnalysisReport?${query}`);
}

export function listScriptVersions(projectId: string) {
    return serverGet<ScriptVersionSummary[]>(`${SCRIPT_PATH}/listVersions?projectId=${encodeURIComponent(projectId)}`);
}

export function createScriptVersion(projectId: string, expectedRevision: number, versionName: string, changeSummary?: string) {
    return serverPost<ScriptVersionSummary>(`${SCRIPT_PATH}/createVersion`, { projectId, expectedRevision, versionName, changeSummary });
}

export function getScriptVersion(projectId: string, versionId: string) {
    return serverPost<ScriptVersionDetail>(`${SCRIPT_PATH}/getVersion`, { projectId, versionId });
}

export function restoreScriptVersion(projectId: string, expectedRevision: number, versionId: string) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/restoreVersion`, { projectId, expectedRevision, versionId });
}

export function getScriptProductionReadiness(projectId: string) {
    return serverPost<ProductionReadiness>(`${SCRIPT_PATH}/getProductionReadiness`, { projectId });
}

export function enterComicDrama(projectId: string, expectedRevision: number) {
    return serverPost<MutationResult>(`${SCRIPT_PATH}/enterComicDrama`, { projectId, expectedRevision });
}
