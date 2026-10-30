"use client";

import { create } from "zustand";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import { pathInSpace } from "../space-path";

export type TeamSummary = { id: number; teamSlug: string; name: string; introduction?: string; logoUrl: string; enabled: boolean; memberRole?: "administrator" | "member"; memberStatus?: string };

/** URL对应的空间是本页唯一作用域，使用整页导航隔离未完成请求与各业务内存缓存。 */
export const useTeamStore = create<{ team: TeamSummary | null; ready: boolean; wallets: { platformBalance: string; teamBalance: string } | null; setWallets: (wallets: { platformBalance: string; teamBalance: string }) => void; setTeam: (team: TeamSummary | null) => void }>((set) => ({
    team: null,
    ready: false,
    wallets: null,
    setWallets: (wallets) => set({ wallets }),
    setTeam: (team) => set({ team, ready: true }),
}));

/** 所有业务本地缓存使用用户和团队组合键，主题、语言等简单偏好继续共用。 */
export function teamStorageKey(key: string) {
    return `${useUserStore.getState().user?.id || "visitor"}:${useTeamStore.getState().team?.id || 0}:${key}`;
}

/** 当前空间管理权限，团队身份不改变账号的全局角色。 */
export function canManageCurrentSpace() {
    const team = useTeamStore.getState().team;
    return team ? team.memberRole === "administrator" : useUserStore.getState().user?.role === "admin";
}

/** 保留已经明确指定的团队或外部链接，其余业务路径使用当前团队前缀。 */
export function teamPath(path: string) {
    return pathInSpace(path, useTeamStore.getState().team?.teamSlug ?? null);
}
