import test from "node:test";
import assert from "node:assert/strict";
import { languageFromAcceptLanguage, resolveWebsiteLocale } from "./locale";
import { translateMessage } from "./translate";
import { createVideoGenerationModeOptions } from "@/features/generation/lib/video-billing";
import { navigationTools } from "@/shared/constants/navigation-tools";

test("首次访问按语言权重匹配，零权重语言不参与匹配", () => {
    assert.equal(languageFromAcceptLanguage("en-US,en;q=0.9,zh-CN;q=0.8"), "en");
    assert.equal(languageFromAcceptLanguage("en;q=0.5,zh-CN;q=0.9"), "zh-cn");
    assert.equal(languageFromAcceptLanguage("zh;q=0,en;q=1"), "en");
    assert.equal(languageFromAcceptLanguage("fr-FR,ja;q=0.8"), "zh-cn");
    assert.equal(languageFromAcceptLanguage(undefined), "zh-cn");
});

test("显式文档路径优先，已保存偏好优先于浏览器语言", () => {
    assert.equal(resolveWebsiteLocale("/image", "en", "zh-CN"), "en");
    assert.equal(resolveWebsiteLocale("/docs/zh-cn/using-studio/canvas", "en", "en-US"), "zh-cn");
    assert.equal(resolveWebsiteLocale("/docs/en", "zh-cn", "zh-CN"), "en");
    assert.equal(resolveWebsiteLocale("/docs", "en", "zh-CN"), "en");
    assert.equal(resolveWebsiteLocale("/canvas/project", "invalid", "en-US"), "en");
});

test("服务端没有浏览器对象时，显示选项也能使用请求语言且不改变业务值", () => {
    const english = createVideoGenerationModeOptions((key, values) => translateMessage(key, values, "en"));
    const chinese = createVideoGenerationModeOptions((key, values) => translateMessage(key, values, "zh-cn"));
    assert.deepEqual(english.map((option) => option.value), chinese.map((option) => option.value));
    assert.equal(english[0].label, "Text to video");
    assert.equal(chinese[0].label, "文生视频");
    assert.equal(translateMessage(navigationTools[0].labelKey, undefined, "en"), "Image");
});
