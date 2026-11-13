import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const imagePageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const videoPageSource = readFileSync(new URL("../video/page.tsx", import.meta.url), "utf8");

test("历史任务的更多设置回显该轮模型渠道", () => {
    assert.ok(imagePageSource.includes('const historyModel = !imageDraftSettingsModified && activeId && latestRound?.config ? latestRound.config.imageModel || latestRound.config.model || "" : "";'), "历史任务模型未从该轮配置读取");
    assert.ok(imagePageSource.includes("value={historyModel || model}"), "更多设置模型未优先使用历史任务模型");
    assert.ok(imagePageSource.includes("const pageSettingsSummary = buildImageSettingsSummary(config, effectiveConfig, model);"), "新对话未使用页面默认配置生成设置摘要");
    assert.ok(imagePageSource.includes("const settingsSummary = historySettingsSummary || pageSettingsSummary;"), "新对话仍回退为更多设置文案");
});

test("视频页新对话直接显示页面默认设置", () => {
    assert.ok(videoPageSource.includes("const pageSettingsSummary = buildVideoSettingsSummary(config, effectiveConfig, model);"), "新对话未使用页面默认配置生成设置摘要");
    assert.ok(videoPageSource.includes("const settingsSummary = historySettingsSummary || pageSettingsSummary;"), "新对话仍回退为更多设置文案");
});
