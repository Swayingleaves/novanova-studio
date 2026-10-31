import { translateMessage } from "@/features/locale/translate";

const getSectionLabels = (translate = translateMessage): Record<string, string> => ({
    overview: translate("script.storyOverview"),
    outlineSections: translate("script.storyOutline"),
    storyEvents: translate("script.keyEvents"),
    characters: translate("script.characters"),
    characterRelations: translate("script.characterRelationships"),
    worldSetting: translate("script.world"),
    worldItems: translate("script.worldRules"),
    locations: translate("script.sceneLocations"),
    episodes: translate("script.episodePlanning"),
    episodeDetails: translate("script.episodeBodyText"),
});

/** 比较版本快照与当前项目，返回发生结构变化的业务区块。 */
export function diffScriptVersion(snapshotData: Record<string, unknown>, currentProject: Record<string, unknown>,
                                  currentEpisodeDetails?: unknown[], translate = translateMessage) {
    const snapshotProject = isRecord(snapshotData.project) ? snapshotData.project : {};
    return Object.entries(getSectionLabels(translate)).flatMap(([key, label]) => {
        const before = key === "episodeDetails" ? snapshotData.episodeDetails : snapshotProject[key];
        const after = key === "episodeDetails" ? currentEpisodeDetails : currentProject[key];
        if (key === "episodeDetails" && currentEpisodeDetails === undefined) return [];
        return JSON.stringify(canonicalize(before ?? null)) !== JSON.stringify(canonicalize(after ?? null))
            ? [{ key, label, before: before ?? null, after: after ?? null }]
            : [];
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 递归排序对象键，避免JSONB重排键顺序造成虚假差异；数组顺序仍保持业务含义。 */
function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}
