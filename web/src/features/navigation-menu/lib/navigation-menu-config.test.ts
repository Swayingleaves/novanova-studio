import assert from "node:assert/strict";
import test from "node:test";

import {
    configurableNavigationTools,
    defaultNavigationMenuDrafts,
    mergeNavigationMenuConfigs,
    navigationMenuDraftSignature,
    resolveVisibleNavigationTools,
} from "./navigation-menu-config";

test("默认配置下按内置顺序返回全部普通菜单，管理员视图末尾固定附带系统管理", () => {
    const userTools = resolveVisibleNavigationTools([], false);
    assert.deepEqual(
        userTools.map((tool) => tool.slug),
        configurableNavigationTools.map((tool) => tool.slug),
    );
    assert.equal(userTools.some((tool) => tool.slug === "admin/system"), false);

    const adminTools = resolveVisibleNavigationTools([], true);
    assert.equal(adminTools.at(-1)?.slug, "admin/system");
    assert.equal(adminTools.length, configurableNavigationTools.length + 1);
});

test("隐藏部分菜单并重排顺序后只展示启用菜单且严格遵循 sortOrder", () => {
    const configs = [
        { menuKey: "assets", enabled: true, sortOrder: 0 },
        { menuKey: "drama", enabled: false, sortOrder: 1 },
        { menuKey: "prompts", enabled: true, sortOrder: 2 },
        { menuKey: "image", enabled: true, sortOrder: 3 },
        { menuKey: "video", enabled: false, sortOrder: 4 },
        { menuKey: "canvas", enabled: true, sortOrder: 5 },
        { menuKey: "script", enabled: true, sortOrder: 6 },
        { menuKey: "comic-drama", enabled: false, sortOrder: 7 },
        { menuKey: "skill-market", enabled: true, sortOrder: 8 },
    ];

    const userTools = resolveVisibleNavigationTools(configs, false);
    assert.deepEqual(
        userTools.map((tool) => tool.slug),
        ["assets", "prompts", "image", "canvas", "script", "skill-market"],
    );

    const adminTools = resolveVisibleNavigationTools(configs, true);
    assert.deepEqual(
        adminTools.map((tool) => tool.slug),
        ["assets", "prompts", "image", "canvas", "script", "skill-market", "admin/system"],
    );
});

test("服务端返回缺项或未知标识时自动过滤未知项并将缺失内置菜单默认开启追加在末尾", () => {
    const merged = mergeNavigationMenuConfigs([
        { menuKey: "unknown-item", enabled: true, sortOrder: 0 },
        { menuKey: "prompts", enabled: false, sortOrder: 1 },
        { menuKey: "image", enabled: true, sortOrder: 2 },
    ]);

    assert.equal(merged.length, configurableNavigationTools.length);
    assert.deepEqual(merged.slice(0, 2), [
        { menuKey: "prompts", enabled: false },
        { menuKey: "image", enabled: true },
    ]);
    assert.equal(merged.some((item) => item.menuKey === "unknown-item"), false);
    assert.equal(merged.slice(2).every((item) => item.enabled), true);
});

test("草稿签名能准确感知顺序变化和显隐切换", () => {
    const base = defaultNavigationMenuDrafts();
    const toggled = base.map((item) => (item.menuKey === "drama" ? { ...item, enabled: false } : item));
    const reordered = [base[1], base[0], ...base.slice(2)];

    assert.equal(navigationMenuDraftSignature(base), navigationMenuDraftSignature(defaultNavigationMenuDrafts()));
    assert.notEqual(navigationMenuDraftSignature(base), navigationMenuDraftSignature(toggled));
    assert.notEqual(navigationMenuDraftSignature(base), navigationMenuDraftSignature(reordered));
});
