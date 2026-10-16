import test from "node:test";
import assert from "node:assert/strict";
import { translateMessage } from "./translate";
import { websiteMessages } from "./messages";
import { cameraMovementOptions, productionParameterLabel } from "../comic-drama/lib/production-labels";
import { getStoryboardFontOptions } from "../comic-drama/components/storyboard-fonts";
import { readinessItemText, scriptTemplateLabel } from "../script/lib/script-localization";
import { diffScriptVersion } from "../script/lib/script-version-diff";
import type { ReadinessItem, ScriptTemplate } from "../script/types";

const english = (key: string, values?: Parameters<typeof translateMessage>[1]) => translateMessage(key, values, "en");
const chinese = (key: string, values?: Parameters<typeof translateMessage>[1]) => translateMessage(key, values, "zh-cn");

test("两个企业版工作台已注册英文资源，固定英文文案不含中文", () => {
    for (const namespace of ["script", "comicDrama"] as const) {
        assert.ok(Object.keys(websiteMessages.en[namespace]).length > 0);
        for (const [key, value] of Object.entries(websiteMessages.en[namespace])) {
            assert.doesNotMatch(value, /\p{Script=Han}/u, `${namespace}.${key}`);
        }
    }
});

test("语言切换立即更新运镜和字体名称，存储值与自定义内容保持不变", () => {
    const initial = cameraMovementOptions(chinese);
    const translated = cameraMovementOptions(english);
    assert.deepEqual(translated.map((item) => item.value), initial.map((item) => item.value));
    assert.equal(initial[0].label, "固定");
    assert.equal(translated[0].label, "Static");
    assert.equal(cameraMovementOptions(chinese)[0].label, "固定");
    assert.equal(productionParameterLabel("中景", english), "Medium shot");
    assert.equal(productionParameterLabel("沿着雨巷缓慢移动", english), "沿着雨巷缓慢移动");
    const chineseFonts = getStoryboardFontOptions(chinese);
    const englishFonts = getStoryboardFontOptions(english);
    assert.deepEqual(englishFonts.map((font) => font.value), chineseFonts.map((font) => font.value));
    assert.equal(englishFonts[0].label, "Chinese · Noto Sans SC");
    assert.equal(getStoryboardFontOptions(chinese)[0].label, "中文 · Noto Sans SC 黑体");
});

test("生产检查与内置模板按当前语言显示，自定义模板和版本内容保留原文", () => {
    for (const key of ["story", "episodes", "scriptContent", "sceneMetadata", "characters", "locations", "pendingAiDrafts"]) {
        const item: ReadinessItem = { key, status: "suggested", title: "检查标题", description: "检查说明", targetSection: "overview" };
        const original = structuredClone(item);
        const labels = readinessItemText(item, english);
        assert.doesNotMatch(labels.title + labels.description, /\p{Script=Han}/u);
        assert.deepEqual(item, original);
    }
    const template = { templateKey: "short-revenge", name: "复仇短剧", description: "模板说明" } as ScriptTemplate;
    assert.match(scriptTemplateLabel(template, english), /^Revenge drama/);
    assert.equal(template.name, "复仇短剧");
    assert.equal(scriptTemplateLabel({ ...template, templateKey: "custom" }, english), "复仇短剧 · 模板说明");
    const differences = diffScriptVersion({ project: { overview: { title: "旧故事" } } }, { overview: { title: "新故事" } }, undefined, english);
    assert.equal(differences[0].label, "Story overview");
    assert.deepEqual(differences[0].after, { title: "新故事" });
});
