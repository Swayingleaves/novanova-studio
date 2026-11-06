import { useUserStore } from "@/features/auth/stores/use-user-store";
import { teamPath } from "@/features/team/stores/use-team-store";

export type HomepageCreationTarget = "image" | "video" | "canvas";

const homepageCreationPaths: Record<HomepageCreationTarget, string> = {
    image: "/image",
    video: "/video",
    canvas: "/canvas",
};

/** 首页发起创作时保留当前空间，访客登录后继续进入同一创作目标。 */
export function startHomepageCreation(prompt: string, target: HomepageCreationTarget = "image") {
    const value = prompt.trim();
    if (!value) return;
    navigateHomepage(`${homepageCreationPaths[target]}?initialPrompt=${encodeURIComponent(value)}`);
}

/** 首页已经写好草稿后，进入图片或视频页由该页自己发起生成。 */
export function openHomepageGeneration(target: Exclude<HomepageCreationTarget, "canvas">) {
    navigateHomepage(homepageCreationPaths[target]);
}

/** 打开画布。已填写的提示词会交给画布列表页创建项目。 */
export function openHomepageCanvas(prompt: string) {
    const value = prompt.trim();
    navigateHomepage(value ? `/canvas?initialPrompt=${encodeURIComponent(value)}` : "/canvas");
}

export type HomepageCanvasStarter = "blank" | "image" | "video";

/** 首页画布入口：空白画布，或带着一个图片/视频节点的新画布。 */
export function openHomepageCanvasStarter(starter: HomepageCanvasStarter) {
    navigateHomepage(starter === "blank" ? "/canvas?newCanvas=1" : `/canvas?initialNode=${starter}`);
}

export function readHomepageCanvasStarter(search: string): HomepageCanvasStarter | null {
    const params = new URLSearchParams(search);
    if (params.get("newCanvas") === "1") return "blank";
    const node = params.get("initialNode");
    return node === "image" || node === "video" ? node : null;
}

function navigateHomepage(path: string) {
    const target = teamPath(path);
    const session = useUserStore.getState();
    if (!session.user) {
        session.openAuthModal(target);
        return;
    }
    window.location.assign(target);
}
