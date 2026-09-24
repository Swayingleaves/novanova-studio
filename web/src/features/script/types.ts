export type ScriptStage = "idea" | "outline" | "writing" | "completed" | "production";
export type ScriptContentType = "comicDrama" | "liveActionShort" | "animation" | "advertisement" | "musicVideo" | "storyShort";
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export type ScriptTemplateSection = { id: string; title: string; sectionType: string; guidance: string; sortOrder: number };
export type ScriptTemplate = {
    templateKey: string;
    category: string;
    name: string;
    description: string;
    contentType: ScriptContentType;
    genre: string;
    structureType: string;
    recommendedEpisodeCount: number;
    sections: ScriptTemplateSection[];
};

export type ScriptProjectSummary = {
    id: string;
    title: string;
    contentType: ScriptContentType;
    genre: string;
    logline: string;
    stage: ScriptStage;
    completionRate: number;
    episodeCount: number;
    targetEpisodeCount: number;
    productionStarted: boolean;
    revision: number;
    updatedAt: string;
};

export type ScriptProjectList = { projects: ScriptProjectSummary[]; total: number; page: number; pageSize: number };

export type ScriptOverview = {
    title: string;
    contentType: ScriptContentType;
    genre: string;
    logline: string;
    synopsis: string;
    targetDurationSeconds: number;
    targetEpisodeCount: number;
    narrativeStyle: string;
    theme: string;
    mainPlot: string;
    mainConflict: string;
    endingDirection: string;
};

export type OutlineSection = { id: string; sectionType: string; title: string; content: string; sortOrder: number };
export type StoryEvent = {
    id: string;
    outlineSectionId?: string | null;
    episodeId?: string | null;
    sceneId?: string | null;
    eventType: string;
    title: string;
    description: string;
    sortOrder: number;
};

export type ScriptCharacter = {
    id: string;
    name: string;
    identity: string;
    age: string;
    occupation: string;
    roleType: string;
    personality: string;
    valuesDescription: string;
    goal: string;
    desire: string;
    fear: string;
    motivation: string;
    appearanceDescription: string;
    habits: string;
    speechStyle: string;
    backgroundStory: string;
    characterArc: string;
    graphPositionX: number;
    graphPositionY: number;
    sortOrder: number;
};

export type CharacterRelation = {
    id: string;
    sourceCharacterId: string;
    targetCharacterId: string;
    relationshipType: string;
    relationshipDirection: "directed" | "bidirectional";
    storyStage: string;
    conflictDescription: string;
    description: string;
    sortOrder: number;
};

export type WorldSetting = { era: string; region: string; socialBackground: string; overallTone: string };
export type WorldItem = { id: string; itemType: string; name: string; description: string; sortOrder: number };
export type ScriptLocation = {
    id: string;
    name: string;
    spacePurpose: string;
    narrativeRole: string;
    defaultTime: string;
    weather: string;
    atmosphere: string;
    keyObjects: string;
    mainEvents: string;
    sortOrder: number;
};

export type EpisodeSummary = {
    id: string;
    episodeNumber: number;
    title: string;
    summary: string;
    keyEvents: string;
    mainConflict: string;
    climax: string;
    endingHook: string;
    targetDurationSeconds: number;
    completionStatus: "planning" | "draft" | "complete";
    sortOrder: number;
};

export type ScriptBlock = { id: string; blockType: "action" | "dialogue" | "narration" | "transition"; characterId?: string | null; content: string; sortOrder: number };
export type ScriptScene = {
    id: string;
    locationId?: string | null;
    sceneNumber: number;
    title: string;
    interiorExterior: "interior" | "exterior" | "mixed";
    timeDescription: string;
    sceneGoal: string;
    actionSummary: string;
    transitionDescription: string;
    previousRelation: string;
    nextRelation: string;
    sortOrder: number;
    characterIds: string[];
    blocks: ScriptBlock[];
};
export type EpisodeDetail = { episode: EpisodeSummary; scenes: ScriptScene[] };

export type ScriptProjectDetail = {
    id: string;
    overview: ScriptOverview;
    outlineSections: OutlineSection[];
    storyEvents: StoryEvent[];
    characters: ScriptCharacter[];
    characterRelations: CharacterRelation[];
    worldSetting: WorldSetting;
    worldItems: WorldItem[];
    locations: ScriptLocation[];
    episodes: EpisodeSummary[];
    stage: ScriptStage;
    completionRate: number;
    productionStarted: boolean;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type MutationResult = { revision: number; stage: ScriptStage; completionRate: number; updatedAt: string };
export type ScriptVersionSummary = { id: string; versionName: string; changeSource: "manual" | "ai"; changeSummary: string; sourceRevision: number; createdAt: string };
export type ScriptVersionDetail = ScriptVersionSummary & { snapshotData: Record<string, unknown> };
export type ScriptAiDraft = {
    id: string;
    projectId: string;
    actionType: string;
    targetType: string;
    targetId?: string | null;
    baseRevision: number;
    instruction: string;
    sourceData: Record<string, unknown>;
    draftData: Record<string, unknown>;
    model: string;
    chargedCredits: number;
    status: "pending" | "applied" | "discarded";
    createdAt: string;
};
export type AnalysisIssue = { id: string; category: string; severity: "info" | "warning" | "important"; episodeId?: string; sceneId?: string; blockId?: string; title: string; reason: string; suggestion: string; sortOrder: number };
export type AnalysisReport = { id: string; projectId: string; scopeType: "project" | "episode"; scopeId?: string; summary: string; model: string; chargedCredits: number; sourceRevision: number; createdAt: string; issues: AnalysisIssue[] };
export type ReadinessItem = { key: string; status: "ready" | "suggested" | "missing"; title: string; description: string; targetSection: string };
export type ProductionReadiness = { projectId: string; ready: boolean; items: ReadinessItem[] };

export type ScriptWorkspaceSection = "overview" | "outline" | "characters" | "world" | "episodes" | "analysis" | "versions";
