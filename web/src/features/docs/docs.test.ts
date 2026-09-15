import test from "node:test";
import assert from "node:assert/strict";
import { getAllDocPages, getDocGroups, getDocPage, localeFromAcceptLanguage, toDocHref, translatedHref } from "./docs";

test("按权重识别中文和英文 Accept-Language", () => {
    assert.equal(localeFromAcceptLanguage("en-US,en;q=0.9,zh-CN;q=0.8"), "en");
    assert.equal(localeFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8"), "zh-cn");
    assert.equal(localeFromAcceptLanguage("fr-FR,zh-CN;q=0"), "zh-cn");
    assert.equal(localeFromAcceptLanguage(undefined), "zh-cn");
});

test("双语文档具有一致的 slug", () => {
    const chinese = new Set(getAllDocPages("zh-cn").map((page) => page.slug.join("/")));
    const english = new Set(getAllDocPages("en").map((page) => page.slug.join("/")));
    assert.deepEqual([...chinese].sort(), [...english].sort());
    assert.ok(getDocPage("zh-cn", ["getting-started", "local-development"]));
    assert.equal(toDocHref("en", ["using-studio", "canvas"]), "/docs/en/using-studio/canvas");
    assert.equal(translatedHref("zh-cn", ["using-studio", "canvas"]), "/docs/en/using-studio/canvas");
    assert.deepEqual(getDocGroups("zh-cn").map((group) => group.key), ["getting-started", "using-studio", "troubleshooting"]);
    assert.deepEqual(getDocGroups("zh-cn")[0].pages.map((page) => page.slug[1]), ["project-introduction", "docker-start", "local-development"]);
});
