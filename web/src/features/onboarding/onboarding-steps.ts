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
export function isDesktopViewport(minWidth = 768): boolean {
    return typeof window !== "undefined" && window.matchMedia(`(min-width: ${minWidth}px)`).matches;
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

/** 创作页导览版本，与 `users.creation_tour_version` 比较。 */
export const CREATION_TOUR_VERSION = 1;

/**
 * 创作页五步导览，重点在「更多设置」。
 * <p>
 * 图片与视频共用同一个工作台组件，因此共用这一套步骤与同一个完成版本号：
 * 先进哪一个就在哪一个展示，另一个不再重复。
 * 工具栏从左到右依次是风格库、参考图、资产库、更多设置、生成按钮，步骤顺序与视觉顺序一致。
 */
export const CREATION_TOUR_STEPS: OnboardingStep[] = [
    {
        target: '[data-tour="composer-style"]',
        titleKey: "onboarding.creationStyleTitle",
        descriptionKey: "onboarding.creationStyleDescription",
        placement: "top",
    },
    {
        target: '[data-tour="composer-upload"]',
        titleKey: "onboarding.creationReferenceTitle",
        descriptionKey: "onboarding.creationReferenceDescription",
        placement: "top",
    },
    {
        target: '[data-tour="composer-assets"]',
        titleKey: "onboarding.creationAssetsTitle",
        descriptionKey: "onboarding.creationAssetsDescription",
        placement: "top",
    },
    {
        target: '[data-tour="composer-settings"]',
        titleKey: "onboarding.creationSettingsTitle",
        descriptionKey: "onboarding.creationSettingsDescription",
        placement: "top",
    },
    {
        target: '[data-tour="creation-submit"]',
        titleKey: "onboarding.creationSubmitTitle",
        descriptionKey: "onboarding.creationSubmitDescription",
        placement: "top",
    },
];

/** 图片与视频创作页（团队前缀已由 usePathname 剥离）。 */
export function isCreationTourPath(pathname: string): boolean {
    return /^\/(image|video)(\/|$)/.test(pathname);
}

/**
 * 判断当前是否应该启动创作页导览。
 * <p>
 * 必须等全局引导完成后才开始，避免两段引导同时抢屏幕。
 * 会话栏在 `lg` 以下隐藏，所以用 1024 作为桌面端门槛。
 */
export function shouldStartCreationTour(input: {
    user: { welcomeRead: boolean; onboardingVersion?: number; creationTourVersion?: number } | null;
    isTeam: boolean;
    pathname: string;
    desktop: boolean;
}): boolean {
    if (!input.user || input.isTeam || !input.desktop) return false;
    if (!input.user.welcomeRead) return false;
    if ((input.user.onboardingVersion ?? 0) < ONBOARDING_VERSION) return false;
    if ((input.user.creationTourVersion ?? 0) >= CREATION_TOUR_VERSION) return false;
    return isCreationTourPath(input.pathname);
}
