"use client";

import { create } from "zustand";
import { useUserStore } from "@/features/auth/stores/use-user-store";
import type { JoinedTeam } from "@/services/api/team";
import { parseSpacePath, pathInSpace } from "../space-path";

/** 选择状态仅存在于当前页面，刷新后不再次弹出登录空间选择。 */
export const useTeamSwitcherStore = create<{ open: boolean; loginTarget: string; switchingTo: string }>()(() => ({
    open: false,
    loginTarget: "",
    switchingTo: "",
}));

/** 登录后直接导航；无团队时省略参数继续原目标，null 表示主动选择平台，不保存登录前遗留数据。 */
export function finishLoginSpaceSelection(team?: JoinedTeam | null) {
    const { open, loginTarget, switchingTo } = useTeamSwitcherStore.getState();
    const session = useUserStore.getState();
    if (!open || !loginTarget || switchingTo || !session.token || session.authenticationRedirect !== loginTarget) return;
    if (team && (!team.enabled || team.memberStatus !== "active")) throw new Error("当前团队或成员已禁用，无法进入");
    const teamSlug = team?.teamSlug ?? null;
    const destination = team === undefined || parseSpacePath(loginTarget).teamSlug === teamSlug ? loginTarget : pathInSpace("/", teamSlug);
    useTeamSwitcherStore.setState({ switchingTo: destination });
    window.location.replace(destination);
}
