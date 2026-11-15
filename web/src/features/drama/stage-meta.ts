import { Clapperboard, FileText, LayoutGrid, Play, ScrollText, Users, type LucideIcon } from "lucide-react";
import type { DramaStage } from "@/services/api/drama";

export const dramaStageMeta: Record<DramaStage, {
    label: "drama.stagePlan" | "drama.stageScript" | "drama.stageCast" | "drama.stageStoryboard" | "drama.stageShot" | "drama.stagePreview";
    icon: LucideIcon;
}> = {
    plan: { label: "drama.stagePlan", icon: ScrollText },
    script: { label: "drama.stageScript", icon: FileText },
    cast: { label: "drama.stageCast", icon: Users },
    storyboard: { label: "drama.stageStoryboard", icon: LayoutGrid },
    shot: { label: "drama.stageShot", icon: Clapperboard },
    preview: { label: "drama.stagePreview", icon: Play },
};
