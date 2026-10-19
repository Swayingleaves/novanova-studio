"use client";

import { useMemo } from "react";
import { resolveSpaceBrand } from "./space-brand";
import { useTeamStore } from "./stores/use-team-store";

/** 直接订阅当前团队品牌，保存资料后同步刷新各处展示。 */
export function useSpaceBrand() {
    const team = useTeamStore((state) => state.team);
    return useMemo(() => resolveSpaceBrand(team), [team]);
}
