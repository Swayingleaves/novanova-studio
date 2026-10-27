import assert from "node:assert/strict";
import test from "node:test";
import { ONBOARDING_STEPS, ONBOARDING_VERSION, hidesSidebar, shouldStartOnboarding } from "./onboarding-steps";

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
