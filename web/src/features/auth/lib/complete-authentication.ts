import { useUserStore } from "@/features/auth/stores/use-user-store";
import { parseSpacePath } from "@/features/team/space-path";
import { resolveAuthenticationRedirect } from "./authentication-path";

/** 原子写入登录态与最终目标，由空间边界统一执行一次完整导航。 */
export function completeAuthentication(session: Parameters<ReturnType<typeof useUserStore.getState>["setSession"]>[0], redirect?: string) {
    const teamSlug = parseSpacePath(window.location.pathname).teamSlug;
    const target = resolveAuthenticationRedirect(redirect, teamSlug);
    useUserStore.getState().setSession(session, target);
}
