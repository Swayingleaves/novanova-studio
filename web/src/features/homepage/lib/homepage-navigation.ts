import { useUserStore } from "@/features/auth/stores/use-user-store";
import { teamPath } from "@/features/team/stores/use-team-store";

/** 首页发起创作时保留当前空间，访客登录后继续进入同一创作目标。 */
export function startHomepageCreation(prompt: string) {
    const value = prompt.trim();
    if (!value) return;
    const target = teamPath(`/image?initialPrompt=${encodeURIComponent(value)}`);
    const session = useUserStore.getState();
    if (!session.user) {
        session.openAuthModal(target);
        return;
    }
    window.location.assign(target);
}
