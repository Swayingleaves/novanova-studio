/**
 * 首次登录引导的步骤定义与启动判定。
 * <p>
 * 引导排在欢迎弹窗之后，覆盖左侧菜单上下两段、右上链接区、右上用户头像四步。
 */

/** 当前引导版本，与 `users.onboarding_version` 比较；改版时递增。 */
export const ONBOARDING_VERSION = 1;

/** 引导遮罩层，高于 antd 的 Tour/Tooltip 默认 1100。 */
export const ONBOARDING_TOUR_Z_INDEX = 1200;

export type OnboardingPlacement =
    | "left"
    | "leftTop"
    | "leftBottom"
    | "right"
    | "rightTop"
    | "rightBottom"
    | "top"
    | "topLeft"
    | "topRight"
    | "bottom"
    | "bottomLeft"
    | "bottomRight";

export type OnboardingStep = {
    /** 目标元素的稳定选择器，统一使用 `data-tour`。 */
    target: string;
    titleKey: string;
    descriptionKey: string;
    placement: OnboardingPlacement;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        target: '[data-tour="sidebar-nav"]',
        titleKey: "onboarding.navigationTitle",
        descriptionKey: "onboarding.navigationDescription",
        placement: "right",
    },
    {
        target: '[data-tour="sidebar-actions"]',
        titleKey: "onboarding.utilitiesTitle",
        descriptionKey: "onboarding.utilitiesDescription",
        placement: "right",
    },
    {
        target: '[data-tour="header-links"]',
        titleKey: "onboarding.headerTitle",
        descriptionKey: "onboarding.headerDescription",
        placement: "bottom",
    },
    {
        target: '[data-tour="user-menu"]',
        titleKey: "onboarding.accountTitle",
        descriptionKey: "onboarding.accountDescription",
        // 头像在最右侧，用户菜单会向左展开约 280px；卡片必须落在头像左侧顶部，
        // 展开菜单时两者会重叠 160px 左右并把 footer 按钮盖掉，所以这里不展开菜单。
        placement: "leftTop",
    },
];

/** 侧栏在 `/canvas/{id}` 详情页整块隐藏，与 `app-shell.tsx` 的 hideSidebar 保持同一规则。 */
export function hidesSidebar(pathname: string): boolean {
    return /^\/canvas\/[^/]+/.test(pathname);
}

/** 引导只在桌面端出现，移动端侧栏是 display:none，无法定位。 */
export function isDesktopViewport(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

/**
 * 判断当前是否应该启动首次登录引导。
 * <p>
 * 团队空间、未登录、欢迎弹窗未消费、已完成当前版本、移动端、画布详情页都跳过。
 * `onboardingVersion` 可能是老会话里的 undefined，按 0 处理。
 */
export function shouldStartOnboarding(input: {
    user: { welcomeRead: boolean; onboardingVersion?: number } | null;
    isTeam: boolean;
    pathname: string;
    desktop: boolean;
}): boolean {
    if (!input.user || input.isTeam || !input.desktop) return false;
    if (!input.user.welcomeRead) return false;
    if ((input.user.onboardingVersion ?? 0) >= ONBOARDING_VERSION) return false;
    return !hidesSidebar(input.pathname);
}
