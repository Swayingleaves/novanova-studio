const SECTION_LABELS: Record<string, string> = {
    overview: "故事概览",
    outlineSections: "故事大纲",
    storyEvents: "关键事件",
    characters: "人物设定",
    characterRelations: "人物关系",
    worldSetting: "世界观",
    worldItems: "世界规则",
    locations: "场景地点",
    episodes: "分集规划",
    episodeDetails: "分集正文",
};

/** 比较版本快照与当前项目，返回发生结构变化的业务区块。 */
export function diffScriptVersion(snapshotData: Record<string, unknown>, currentProject: Record<string, unknown>,
                                  currentEpisodeDetails?: unknown[]) {
    const snapshotProject = isRecord(snapshotData.project) ? snapshotData.project : {};
    return Object.entries(SECTION_LABELS).flatMap(([key, label]) => {
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
