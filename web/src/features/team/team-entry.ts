import { getPublicTeam, listMyTeams } from "@/services/api/team";
import { isAuthenticationPath, parseSpacePath } from "./space-path";
import type { TeamSummary } from "./stores/use-team-store";

/** 认证页仅加载公开品牌，已登录用户进入团队业务页面时必须重新验证有效成员身份。 */
export async function loadTeamEntry(teamSlug: string, authenticationPage: boolean, token: string, signal: AbortSignal) {
    const team = await getPublicTeam(teamSlug, signal);
    if (!team.enabled) throw new Error("团队已被禁用");
    if (authenticationPage || !token) return team;
    const memberships = await listMyTeams({ signal });
    const membership = memberships.find((item) => item.id === team.id);
    if (!membership) throw new Error("尚未加入当前团队，请先在平台空间接受邀请");
    if (!membership.enabled) throw new Error("团队已被禁用");
    if (membership.memberStatus !== "active") throw new Error("团队成员已被禁用或移除");
    return { ...team, ...membership };
}

/** 公开品牌不代表业务访问权，认证页和未验证成员均不能启动业务初始化。 */
export function canInitializeSpaceBusiness(path: string, team: TeamSummary | null) {
    if (isAuthenticationPath(path)) return false;
    const teamSlug = parseSpacePath(path).teamSlug;
    return teamSlug ? team?.teamSlug === teamSlug && team.memberStatus === "active" && team.enabled : team === null;
}
