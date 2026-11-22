import { Clapperboard, FileText, Play, ScrollText, Users, type LucideIcon } from "lucide-react";
import type { DramaStage } from "@/services/api/drama";

/** 每个阶段的阶段名、图标、对话身份，以及卡片下方可点的建议。 */
export const dramaStageMeta: Record<DramaStage, {
    label: "drama.stagePlan" | "drama.stageScript" | "drama.stageCast" | "drama.stageShot" | "drama.stagePreview";
    icon: LucideIcon;
    /** 对话里这个阶段由哪个身份应答。 */
    agentKey: string;
    /** 点一下填进输入框的建议，不自动发送。 */
    suggestions: string[];
}> = {
    plan: {
        label: "drama.stagePlan",
        icon: ScrollText,
        agentKey: "drama.agentDirector",
        suggestions: ["drama.suggestPlanDirection", "drama.suggestPlanGenre", "drama.suggestPlanDuration"],
    },
    script: {
        label: "drama.stageScript",
        icon: FileText,
        agentKey: "drama.agentWriter",
        suggestions: ["drama.suggestScriptConflict", "drama.suggestScriptHook", "drama.suggestScriptDialogue"],
    },
    cast: {
        label: "drama.stageCast",
        icon: Users,
        agentKey: "drama.agentCharacterDesigner",
        suggestions: ["drama.suggestCastAppearance", "drama.suggestCastExtra", "drama.suggestCastImage"],
    },
    shot: {
        label: "drama.stageShot",
        icon: Clapperboard,
        agentKey: "drama.agentCinematographer",
        suggestions: ["drama.suggestBoardDuration", "drama.suggestShotVideo", "drama.suggestShotCamera"],
    },
    preview: {
        label: "drama.stagePreview",
        icon: Play,
        agentKey: "drama.agentEditor",
        suggestions: ["drama.suggestPreviewCompose", "drama.suggestPreviewExport", "drama.suggestPreviewCheck"],
    },
};
