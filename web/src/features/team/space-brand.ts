import type { TeamSummary } from "./stores/use-team-store";

export type SpaceBrand = {
    name: string;
    logoUrl: string;
    iconUrl: string;
    introduction: string;
    agentName: string;
    isTeam: boolean;
};

/** 平台默认品牌，团队未配置 Logo 时使用相应的默认图标。 */
const platformBrand: SpaceBrand = {
    name: "Novanova Studio",
    logoUrl: "/logo/novanovastudio.svg",
    iconUrl: "/logo/novanovastudio-108x108.png",
    introduction: "",
    agentName: "Novanova Agent",
    isTeam: false,
};

/** 根据当前团队解析展示品牌，保留团队名称原有大小写。 */
export function resolveSpaceBrand(team: TeamSummary | null): SpaceBrand {
    return team ? {
        name: team.name,
        logoUrl: team.logoUrl || platformBrand.logoUrl,
        iconUrl: team.logoUrl || platformBrand.iconUrl,
        introduction: team.introduction || "",
        agentName: `${team.name} Agent`,
        isTeam: true,
    } : platformBrand;
}

/** 统一同步页面品牌；产品说明页保留平台品牌，退出团队时恢复平台图标。 */
export function synchronizeDocumentBrand(brand: SpaceBrand, pathname: string, platformMetadata: { description: string; editionsTitle: string; editionsDescription: string }) {
    const docsPage = /^\/docs(?:\/|$)/.test(pathname);
    const editionsPage = pathname === "/editions";
    const documentBrand = docsPage || editionsPage || pathname === "/credits/purchase" ? platformBrand : brand;
    if (!docsPage) {
        document.title = editionsPage ? platformMetadata.editionsTitle : documentBrand.name;
        document.querySelector('meta[name="description"]')?.setAttribute("content", editionsPage ? platformMetadata.editionsDescription : documentBrand.introduction || platformMetadata.description);
    }
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach((icon) => {
        icon.href = documentBrand.iconUrl;
        // Logo 可使用不同图片格式，不沿用原图标的格式及尺寸声明。
        icon.removeAttribute("type");
        icon.removeAttribute("sizes");
    });
}
