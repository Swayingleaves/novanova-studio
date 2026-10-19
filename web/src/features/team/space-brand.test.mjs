import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { resolveSpaceBrand, synchronizeDocumentBrand } from "./space-brand.ts";

const team = { id: 101, teamSlug: "team1", name: "My 创作团队", logoUrl: "https://example.com/team-logo.svg", introduction: "团队介绍", enabled: true };
const platformMetadata = { description: "平台介绍", editionsTitle: "Novanova Studio 版本对比", editionsDescription: "产品版本说明" };

test("团队品牌保留名称与大小写，只有未配置 Logo 时才使用平台图标", () => {
    const brand = resolveSpaceBrand(team);
    assert.equal(brand.name, "My 创作团队");
    assert.equal(brand.logoUrl, team.logoUrl);
    assert.equal(brand.iconUrl, team.logoUrl);
    assert.equal(brand.agentName, "My 创作团队 Agent");
    assert.equal(brand.introduction, "团队介绍");
    assert.equal(brand.isTeam, true);
    const platform = resolveSpaceBrand(null);
    const withoutLogo = resolveSpaceBrand({ ...team, logoUrl: "" });
    assert.equal(withoutLogo.logoUrl, platform.logoUrl);
    assert.equal(withoutLogo.iconUrl, platform.iconUrl);
    assert.equal(withoutLogo.name, team.name);
    assert.equal(withoutLogo.isTeam, true);
    assert.equal(platform.name, "Novanova Studio");
    assert.equal(platform.agentName, "Novanova Agent");
    assert.equal(platform.isTeam, false);
    assert.equal(existsSync(new URL(`../../../public${platform.logoUrl}`, import.meta.url)), true);
    assert.equal(existsSync(new URL(`../../../public${platform.iconUrl}`, import.meta.url)), true);
    const longName = "Mixed中文团队".repeat(10);
    assert.equal(resolveSpaceBrand({ ...team, name: longName }).name, longName);
    const unavailableLogo = "https://example.com/unavailable.png";
    assert.equal(resolveSpaceBrand({ ...team, logoUrl: unavailableLogo }).logoUrl, unavailableLogo);
});

test("浏览器品牌随团队切换、资料修改、清空 Logo 和返回平台同步恢复", () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const description = new Map([["content", "初始介绍"]]);
    const icons = ["icon", "shortcut icon", "apple-touch-icon"].map((relation) => {
        const attributes = new Map([["rel", relation], ["type", "image/png"], ["sizes", "32x32"]]);
        return { href: "旧图标", attributes, removeAttribute: (key) => attributes.delete(key) };
    });
    const currentDocument = {
        title: "初始标题",
        querySelector: () => ({ setAttribute: (key, value) => description.set(key, value) }),
        querySelectorAll: () => icons,
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: currentDocument });
    try {
        const brands = [
            resolveSpaceBrand(team),
            resolveSpaceBrand({ ...team, id: 102, name: "团队乙", introduction: "团队乙介绍", logoUrl: "https://example.com/team-b.png" }),
            resolveSpaceBrand({ ...team, name: "更新后的团队", introduction: "新的介绍", logoUrl: "https://example.com/uploaded-logo.webp" }),
            resolveSpaceBrand({ ...team, logoUrl: "", introduction: "" }),
            resolveSpaceBrand(null),
        ];
        for (const brand of brands) {
            synchronizeDocumentBrand(brand, "/", platformMetadata);
            assert.equal(currentDocument.title, brand.name);
            assert.equal(description.get("content"), brand.introduction || platformMetadata.description);
            assert.deepEqual(icons.map((icon) => icon.href), Array(3).fill(brand.iconUrl));
            assert.equal(icons.every((icon) => !icon.attributes.has("type") && !icon.attributes.has("sizes")), true);
        }
        synchronizeDocumentBrand(resolveSpaceBrand(team), "/editions", platformMetadata);
        assert.equal(currentDocument.title, platformMetadata.editionsTitle);
        assert.equal(description.get("content"), platformMetadata.editionsDescription);
        assert.equal(icons[0].href, resolveSpaceBrand(null).iconUrl);

        currentDocument.title = "当前文档标题";
        description.set("content", "当前文档介绍");
        synchronizeDocumentBrand(resolveSpaceBrand(team), "/docs/zh-cn/workspace", platformMetadata);
        assert.equal(currentDocument.title, "当前文档标题");
        assert.equal(description.get("content"), "当前文档介绍");
        assert.equal(icons[0].href, resolveSpaceBrand(null).iconUrl);

        synchronizeDocumentBrand(resolveSpaceBrand(team), "/credits/purchase", platformMetadata);
        assert.equal(currentDocument.title, resolveSpaceBrand(null).name);
        assert.equal(description.get("content"), platformMetadata.description);
        assert.equal(icons[0].href, resolveSpaceBrand(null).iconUrl);
    } finally {
        if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
        else Reflect.deleteProperty(globalThis, "document");
    }
});
