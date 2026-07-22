import assert from "node:assert/strict";
import test from "node:test";

import { getAntThemeConfig } from "./app-theme.ts";

test("getAntThemeConfig 返回浅色主题 token", () => {
    const config = getAntThemeConfig("light");

    assert.equal(config.token?.colorBgLayout, "#f7f5ff");
    assert.equal(config.token?.colorText, "#0f172a");
    assert.equal(config.components?.Modal?.contentBg, "#ffffff");
    assert.equal(config.components?.Modal?.headerBg, "#ffffff");
    assert.equal(config.components?.Modal?.footerBg, "#ffffff");
});

test("getAntThemeConfig 返回暗色主题 token", () => {
    const config = getAntThemeConfig("dark");

    assert.equal(config.token?.colorBgLayout, "#0b1020");
    assert.equal(config.token?.colorText, "#eef2ff");
    assert.equal(config.token?.colorBgContainer, "rgba(15,23,42,0.84)");
    assert.equal(config.components?.Modal?.contentBg, "#111827");
    assert.equal(config.components?.Modal?.headerBg, "#111827");
    assert.equal(config.components?.Modal?.footerBg, "#111827");
});
