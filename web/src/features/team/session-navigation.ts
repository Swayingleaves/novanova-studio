import { useUserStore } from "@/features/auth/stores/use-user-store";
import { useTeamStore } from "./stores/use-team-store";
import { useTeamSwitcherStore } from "./stores/use-team-switcher-store";
import { parseSpacePath, pathInSpace } from "./space-path";

/** 退出时清理旧空间并回到当前空间登录页，直接更换账号仍返回平台重新选择空间。 */
export function subscribeSessionNavigation(beforeNavigation: () => void) {
    return useUserStore.subscribe((state, previous) => {
        if (state.token === previous.token && state.authenticationRedirect === previous.authenticationRedirect) return;
        const signedOut = previous.token && !state.token;
        const changedAccount = previous.user && state.user && previous.user.id !== state.user.id;
        if (signedOut || changedAccount) {
            const destination = signedOut ? pathInSpace("/auth", parseSpacePath(window.location.pathname).teamSlug) : "/";
            beforeNavigation();
            useTeamStore.setState({ team: null, wallets: null, ready: false });
            useTeamSwitcherStore.setState({ open: false, loginTarget: "", switchingTo: "" });
            window.location.replace(destination);
        } else if (state.authenticationRedirect) {
            beforeNavigation();
            useTeamStore.setState({ team: null, wallets: null, ready: false });
            // 团队入口（包括 OAuth 恢复的团队目标）直接进入，平台普通账号先选择空间。
            const loginTeamSlug = parseSpacePath(window.location.pathname).teamSlug
                ?? (window.location.pathname === "/auth/oauthCallback" ? parseSpacePath(state.authenticationRedirect).teamSlug : null);
            if (state.user?.role === "user" && !loginTeamSlug) {
                useTeamSwitcherStore.setState({ open: true, loginTarget: state.authenticationRedirect, switchingTo: "" });
            } else {
                window.location.replace(state.authenticationRedirect);
            }
        } else if (useTeamStore.getState().ready) {
            beforeNavigation();
            window.location.reload();
        }
    });
}
