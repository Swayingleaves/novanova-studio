import assert from "node:assert/strict";
import test from "node:test";

import { creatorMonogram, filterFantasticShowcases, getFantasticShowcases } from "./fantastic-show";
import type { HomepageShowcase } from "@/services/api/server";

const showcase = (id: number, category: string, creatorName: string, title = "作品标题"): HomepageShowcase => ({
    id,
    title,
    description: "作品描述",
    category,
    creatorName,
    mediaType: "image",
    mediaUrl: "/sample.jpg",
    thumbnailUrl: "",
    targetType: "image",
    targetPath: "/image",
    promptContent: "",
    sortOrder: id,
    status: 1,
});

test("精彩创作跳过首页顶部的前三条内容", () => {
    assert.deepEqual(
        getFantasticShowcases([showcase(1, "视觉海报", "林夏"), showcase(2, "概念短片", "苏澈"), showcase(3, "商业广告", "张默"), showcase(4, "产品视觉", "Miro")]).map((item) => item.id),
        [4],
    );
});

test("精彩创作支持分类和标题、描述、创作者关键词搜索", () => {
    const items = [showcase(1, "视觉海报", "林夏", "雾城回声"), showcase(2, "产品视觉", "Miro", "玻璃脉冲")];
    assert.deepEqual(
        filterFantasticShowcases(items, "视觉海报", "").map((item) => item.id),
        [1],
    );
    assert.deepEqual(
        filterFantasticShowcases(items, "全部", "miro").map((item) => item.id),
        [2],
    );
    assert.deepEqual(
        filterFantasticShowcases(items, "全部", "不存在").map((item) => item.id),
        [],
    );
});

test("创作者首字母兼容中文和英文名称", () => {
    assert.equal(creatorMonogram("林夏"), "林夏");
    assert.equal(creatorMonogram("Kite Workshop"), "KW");
});
