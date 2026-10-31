"use client";

import { useMemo } from "react";

import { useComicDramaStore } from "../stores/use-comic-drama-store";

/**
 * 上游变更待确认的目标集合，键形如 `shot:<id>`、`asset:<id>`、`promptVersion:<id>`。
 *
 * 剧本侧改动只写入 `comic_drama_change_impacts` 作为待确认项，不会改动下游实体自身的状态，
 * 因此界面上的「需要更新」提示必须由此派生，而不是读镜头/资产的状态列。
 *
 * @returns 待确认目标的键集合
 */
export function usePendingImpactTargets() {
    const impacts = useComicDramaStore((state) => state.workspace?.impacts);
    return useMemo(() => {
        const targets = new Set<string>();
        for (const impact of impacts || []) {
            if (impact.status === "pending") targets.add(`${impact.targetType}:${impact.targetId}`);
        }
        return targets;
    }, [impacts]);
}
