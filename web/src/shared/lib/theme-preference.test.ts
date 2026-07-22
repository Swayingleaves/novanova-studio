import assert from "node:assert/strict";
import test from "node:test";

import {
    THEME_COOKIE_KEY,
    THEME_STORAGE_KEY,
    buildThemeBootstrapScript,
    getInitialResolvedTheme,
    normalizeThemePreference,
    parseThemePreferenceFromCookie,
    resolveThemePreference,
} from "./theme-preference.ts";

test("normalizeThemePreference 仅接受 system、light、dark", () => {
    assert.equal(normalizeThemePreference("system"), "system");
    assert.equal(normalizeThemePreference("light"), "light");
    assert.equal(normalizeThemePreference("dark"), "dark");
    assert.equal(normalizeThemePreference("auto"), null);
    assert.equal(normalizeThemePreference(null), null);
});

test("resolveThemePreference 在 system 下按系统主题解析", () => {
    assert.equal(resolveThemePreference("system", true), "dark");
    assert.equal(resolveThemePreference("system", false), "light");
    assert.equal(resolveThemePreference("light", true), "light");
    assert.equal(resolveThemePreference("dark", false), "dark");
});

test("parseThemePreferenceFromCookie 只读取目标 cookie", () => {
    const cookieValue = `${THEME_COOKIE_KEY}=dark; another=1`;
    assert.equal(parseThemePreferenceFromCookie(cookieValue), "dark");
    assert.equal(parseThemePreferenceFromCookie("another=1"), null);
});

test("getInitialResolvedTheme 仅对显式 dark 返回暗色，其余默认浅色", () => {
    assert.equal(getInitialResolvedTheme("dark"), "dark");
    assert.equal(getInitialResolvedTheme("light"), "light");
    assert.equal(getInitialResolvedTheme("system"), "light");
});

test("buildThemeBootstrapScript 包含本地存储、cookie 和 matchMedia 分支", () => {
    const script = buildThemeBootstrapScript("system");

    assert.match(script, new RegExp(THEME_STORAGE_KEY));
    assert.match(script, new RegExp(THEME_COOKIE_KEY));
    assert.match(script, /matchMedia/);
    assert.match(script, /data-theme/);
    assert.match(script, /colorScheme/);
});
