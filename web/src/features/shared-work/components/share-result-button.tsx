"use client";
import { Button, Tooltip } from "antd";
import { Share2 } from "lucide-react";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { useSharedWorkStore } from "../stores/use-shared-work-store";

/** 生成结果操作区和详情共用的分享入口。 */
export function ShareResultButton({ mediaId, storageKey }: { mediaId?: string; storageKey?: string }) {
    const source = useSharedWorkStore((state) => (mediaId ? state.generationSources[mediaId] : undefined) || (storageKey ? state.generationSources[storageKey] : undefined));
    const open = useSharedWorkStore((state) => state.open);
    const team = useTeamStore((state) => state.team);
    if (!source || (team && team.memberRole !== "administrator")) return null;
    return <Tooltip title="分享作品"><Button aria-label="分享作品" size="small" className="!h-7 !w-7 !min-w-0 !rounded-full !p-0" icon={<Share2 className="size-3.5" />} onClick={() => open(source)} /></Tooltip>;
}
