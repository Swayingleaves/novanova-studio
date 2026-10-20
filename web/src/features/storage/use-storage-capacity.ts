"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useTeamStore } from "@/features/team/stores/use-team-store";
import { getStorageCapacity } from "@/services/api/storage";
import { storageCapacityChangedEvent } from "./capacity-events";

/** 全局容量查询按用户与空间隔离，文件变化后同步所有使用处。 */
export function useStorageCapacity(poll = false) {
    const userId = useUserStore((state) => state.user?.id);
    const teamId = useTeamStore((state) => state.team?.id || 0);
    const ready = useTeamStore((state) => state.ready);
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["storageCapacity", userId, teamId], queryFn: getStorageCapacity, enabled: !!userId && ready, refetchInterval: poll ? 15_000 : false });
    useEffect(() => {
        if (!userId || !ready) return;
        const refresh = () => {
            void client.invalidateQueries({ queryKey: ["storageCapacity", userId, teamId] });
            void client.invalidateQueries({ queryKey: ["storageFiles", userId, teamId] });
        };
        window.addEventListener(storageCapacityChangedEvent, refresh);
        return () => window.removeEventListener(storageCapacityChangedEvent, refresh);
    }, [client, userId, teamId, ready]);
    return query;
}
