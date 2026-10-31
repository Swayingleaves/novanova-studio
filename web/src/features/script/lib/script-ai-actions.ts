import type { TranslationKey } from "@/features/locale/translate";

/** 剧本 AI 助手的动作定义：助手面板与后台动作定价共用同一份清单，避免两处漂移。 */
export type ScriptAiActionDefinition = { value: string; labelKey: TranslationKey; sections: string[] };

/** 动作清单顺序即后台定价表的展示顺序，与服务端 `ScriptAiActions` 保持一致。 */
export const SCRIPT_AI_ACTIONS: ScriptAiActionDefinition[] = [
    { value: "storyDirections", labelKey: "script.generateStoryDirections", sections: ["overview"] },
    { value: "outline", labelKey: "script.generateStoryOutline", sections: ["outline"] },
    { value: "characters", labelKey: "script.generateCharactersAndRelationships", sections: ["characters"] },
    { value: "world", labelKey: "script.generateWorldAndLocations", sections: ["world"] },
    { value: "episodePlan", labelKey: "script.generateEpisodePlans", sections: ["episodes"] },
    { value: "episodeDraft", labelKey: "script.generateEpisodeScenesAndText", sections: ["episodes"] },
    { value: "polish", labelKey: "script.polish", sections: ["episodes"] },
    { value: "expand", labelKey: "script.expand", sections: ["episodes"] },
    { value: "condense", labelKey: "script.condense", sections: ["episodes"] },
    { value: "rewrite", labelKey: "script.rewrite", sections: ["episodes"] },
    { value: "colloquialize", labelKey: "script.makeConversational", sections: ["episodes"] },
    { value: "dialogue", labelKey: "script.improveDialogue", sections: ["episodes"] },
    { value: "conflict", labelKey: "script.strengthenConflict", sections: ["episodes"] },
    { value: "suspense", labelKey: "script.improveSuspense", sections: ["episodes"] },
    { value: "twist", labelKey: "script.improveTwists", sections: ["episodes"] },
    { value: "motivation", labelKey: "script.improveMotivation", sections: ["episodes"] },
    { value: "emotion", labelKey: "script.improveEmotion", sections: ["episodes"] },
    { value: "climax", labelKey: "script.improveClimax", sections: ["episodes"] },
    { value: "rhythm", labelKey: "script.improvePacing", sections: ["episodes"] },
    { value: "style", labelKey: "script.improveStyle", sections: ["episodes"] },
];
