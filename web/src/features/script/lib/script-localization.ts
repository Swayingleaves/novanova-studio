import { translateMessage } from "@/features/locale/translate";
import type { ReadinessItem, ScriptTemplate } from "../types";

/** 生产检查的稳定标识对应界面文案，用户输入的剧本内容不参与翻译。 */
const readinessMessageKeys: Record<string, { title: string; description: string }> = {
    story: { title: "script.readinessStoryTitle", description: "script.readinessStoryDescription" },
    episodes: { title: "script.readinessEpisodesTitle", description: "script.readinessEpisodesDescription" },
    scriptContent: { title: "script.readinessScriptContentTitle", description: "script.readinessScriptContentDescription" },
    sceneMetadata: { title: "script.readinessSceneMetadataTitle", description: "script.readinessSceneMetadataDescription" },
    characters: { title: "script.readinessCharactersTitle", description: "script.readinessCharactersDescription" },
    locations: { title: "script.readinessLocationsTitle", description: "script.readinessLocationsDescription" },
    pendingAiDrafts: { title: "script.readinessPendingAiDraftsTitle", description: "script.readinessPendingAiDraftsDescription" },
};

/** 两个工作台共享同一组生产检查的展示翻译。 */
export function readinessItemText(item: ReadinessItem, translate = translateMessage) {
    const keys = readinessMessageKeys[item.key];
    return {
        title: translate(keys.title),
        description: translate(item.key === "pendingAiDrafts" && item.status === "ready" ? "script.readinessNoPendingAiDrafts" : keys.description),
    };
}

/** 内置模板按稳定键展示双语名称，自定义模板保留管理员填写的内容。 */
const templateMessageKeys: Record<string, string> = {
    "short-revenge": "script.templateShortRevenge",
    "short-rebirth": "script.templateShortRebirth",
    "short-suspense": "script.templateShortSuspense",
    "short-romance": "script.templateShortRomance",
    "short-urban": "script.templateShortUrban",
    "short-time-travel": "script.templateShortTimeTravel",
    "comic-fantasy": "script.templateComicFantasy",
    "comic-immortal": "script.templateComicImmortal",
    "comic-apocalypse": "script.templateComicApocalypse",
    "comic-science-fiction": "script.templateComicScienceFiction",
    "comic-martial-arts": "script.templateComicMartialArts",
    "comic-campus": "script.templateComicCampus",
    "narrative-advertisement": "script.templateNarrativeAdvertisement",
    "narrative-music-video": "script.templateNarrativeMusicVideo",
    "narrative-promotion": "script.templateNarrativePromotion",
    "narrative-story-short": "script.templateNarrativeStoryShort",
};

/** 只改变模板选项标签，不回写模板和项目。 */
export function scriptTemplateLabel(template: ScriptTemplate, translate = translateMessage) {
    const key = templateMessageKeys[template.templateKey];
    return key ? translate(key) : `${template.name} · ${template.description}`;
}
