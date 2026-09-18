import assert from "node:assert/strict";
import test from "node:test";

import { getAntThemeConfig } from "./app-theme.ts";

test("getAntThemeConfig 返回浅色主题 token", () => {
    const config = getAntThemeConfig("light");

    assert.equal(config.token?.colorBgLayout, "#f4f5f2");
    assert.equal(config.token?.colorText, "#171a17");
    assert.equal(config.components?.Modal?.contentBg, "#ffffff");
    assert.equal(config.components?.Modal?.headerBg, "#ffffff");
    assert.equal(config.components?.Modal?.footerBg, "#ffffff");
});

test("getAntThemeConfig 返回暗色主题 token", () => {
    const config = getAntThemeConfig("dark");

    assert.equal(config.token?.colorBgLayout, "#050606");
    assert.equal(config.token?.colorText, "#f3f6f0");
    assert.equal(config.token?.colorBgContainer, "#0c0e0d");
    assert.equal(config.components?.Modal?.contentBg, "#0c0e0d");
    assert.equal(config.components?.Modal?.headerBg, "#0c0e0d");
    assert.equal(config.components?.Modal?.footerBg, "#0c0e0d");
});

test("getAntThemeConfig 紫色主题使用深色底与浅色文字", () => {
    const config = getAntThemeConfig("purple");

    assert.equal(config.token?.colorBgLayout, "#050505");
    assert.equal(config.token?.colorBgContainer, "#0d0d0f");
    assert.equal(config.token?.colorText, "#f5f5f5");
    assert.equal(config.token?.colorBgElevated, "#141418");
    assert.equal(config.components?.Modal?.contentBg, "#0d0d0f");
    assert.equal(config.components?.Modal?.headerBg, "#0d0d0f");
    assert.equal(config.components?.Modal?.footerBg, "#0d0d0f");
});
