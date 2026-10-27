import assert from "node:assert/strict";
import test from "node:test";
import {
    CREATION_TOUR_STEPS,
    CREATION_TOUR_VERSION,
    ONBOARDING_STEPS,
    ONBOARDING_VERSION,
    hidesSidebar,
    isCreationTourPath,
    shouldStartCreationTour,
    shouldStartOnboarding,
} from "./onboarding-steps";

const base = {
    user: { welcomeRead: true, onboardingVersion: 0 },
    isTeam: false,
    pathname: "/",
    desktop: true,
};

test("只在欢迎弹窗已消费、未完成当前版本、非团队空间的桌面端启动", () => {
    assert.equal(shouldStartOnboarding(base), true);
    assert.equal(shouldStartOnboarding({ ...base, user: null }), false);
    assert.equal(shouldStartOnboarding({ ...base, isTeam: true }), false);
    assert.equal(shouldStartOnboarding({ ...base, user: { welcomeRead: false, onboardingVersion: 0 } }), false);
    assert.equal(shouldStartOnboarding({ ...base, user: { welcomeRead: true, onboardingVersion: ONBOARDING_VERSION } }), false);
    assert.equal(shouldStartOnboarding({ ...base, user: { welcomeRead: true, onboardingVersion: ONBOARDING_VERSION + 1 } }), false);
    assert.equal(shouldStartOnboarding({ ...base, desktop: false }), false);
    assert.equal(shouldStartOnboarding({ ...base, pathname: "/canvas/abc" }), false);
    assert.equal(shouldStartOnboarding({ ...base, pathname: "/canvas" }), true);
});

test("老会话缺少 onboardingVersion 时按 0 处理", () => {
    assert.equal(shouldStartOnboarding({ ...base, user: { welcomeRead: true } }), true);
});

test("引导锚点固定，且画布详情页与侧栏隐藏规则一致", () => {
    assert.deepEqual(
        ONBOARDING_STEPS.map((step) => step.target),
        ['[data-tour="sidebar-nav"]', '[data-tour="sidebar-actions"]', '[data-tour="header-links"]', '[data-tour="user-menu"]'],
    );
    assert.equal(hidesSidebar("/canvas/abc"), true);
    assert.equal(hidesSidebar("/canvas/abc/edit"), true);
    assert.equal(hidesSidebar("/canvas"), false);
});

test("创作页导览等全局引导完成后才启动，图片与视频共用同一个版本号", () => {
    const creationBase = {
        user: { welcomeRead: true, onboardingVersion: ONBOARDING_VERSION, creationTourVersion: 0 },
        isTeam: false,
        pathname: "/image",
        desktop: true,
    };

    assert.equal(shouldStartCreationTour(creationBase), true);
    assert.equal(shouldStartCreationTour({ ...creationBase, pathname: "/video" }), true);
    assert.equal(shouldStartCreationTour({ ...creationBase, pathname: "/canvas" }), false);
    assert.equal(shouldStartCreationTour({ ...creationBase, pathname: "/assets" }), false);

    // 全局引导没看完时不插队。
    assert.equal(shouldStartCreationTour({ ...creationBase, user: { welcomeRead: true, onboardingVersion: 0, creationTourVersion: 0 } }), false);
    // 已经看过一次（无论当时在图片还是视频）就不再重复。
    assert.equal(shouldStartCreationTour({ ...creationBase, user: { welcomeRead: true, onboardingVersion: ONBOARDING_VERSION, creationTourVersion: CREATION_TOUR_VERSION } }), false);
    // 老会话缺少 creationTourVersion 时按 0 处理。
    assert.equal(shouldStartCreationTour({ ...creationBase, user: { welcomeRead: true, onboardingVersion: ONBOARDING_VERSION } }), true);
    // 团队空间与窄屏（会话栏隐藏）都跳过。
    assert.equal(shouldStartCreationTour({ ...creationBase, isTeam: true }), false);
    assert.equal(shouldStartCreationTour({ ...creationBase, desktop: false }), false);
});

test("创作页五步锚点固定，路径只匹配图片与视频", () => {
    assert.deepEqual(
        CREATION_TOUR_STEPS.map((step) => step.target),
        [
            '[data-tour="composer-style"]',
            '[data-tour="composer-upload"]',
            '[data-tour="composer-assets"]',
            '[data-tour="composer-settings"]',
            '[data-tour="creation-submit"]',
        ],
    );
    assert.equal(isCreationTourPath("/image"), true);
    assert.equal(isCreationTourPath("/video"), true);
    assert.equal(isCreationTourPath("/images"), false);
    assert.equal(isCreationTourPath("/video-editor"), false);
});
