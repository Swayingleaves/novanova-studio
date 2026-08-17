import assert from "node:assert/strict";
import test from "node:test";

import { ALL_GENERATION_STYLE_CATEGORY, collectGenerationStyleCategories, filterGenerationStyles, generationStyleAt, isGenerationStyleSelected, MAX_GENERATION_STYLE_SELECTION_COUNT, usesGenerationStyleDefaultCover } from "./generation-style-library.ts";

test("当前生成请求最多选择一个风格", () => {
    assert.equal(MAX_GENERATION_STYLE_SELECTION_COUNT, 1);
});

const styles = [
    { id: 1, name: "电影肖像", generationType: "image" as const, coverUrl: "https://example.com/cinematic.jpg", category: "人像" },
    { id: 2, name: "水墨山水", generationType: "image" as const, coverUrl: "https://example.com/ink.jpg", category: "国风" },
    { id: 3, name: "旧版胶片", generationType: "video" as const, coverUrl: "", category: "电影" },
    { id: 4, name: "赛博街景", generationType: "video" as const, coverUrl: "https://example.com/cyber.jpg", category: "电影" },
];

test("风格库从已排序的有封面记录中汇总非空分类并保留首次出现顺序", () => {
    assert.deepEqual(collectGenerationStyleCategories([...styles, { ...styles[0], id: 5, category: "" }, { ...styles[2], id: 6, category: "旧版" }]), ["人像", "国风", "电影"]);
});

test("风格库搜索匹配名称和分类，旧记录默认封面仅显示在全部分类", () => {
    assert.deepEqual(
        filterGenerationStyles(styles, "电影", ALL_GENERATION_STYLE_CATEGORY).map((style) => style.id),
        [1, 3, 4],
    );
    assert.deepEqual(
        filterGenerationStyles(styles, "", "电影").map((style) => style.id),
        [4],
    );
    assert.deepEqual(
        filterGenerationStyles(styles, "国风", "国风").map((style) => style.id),
        [2],
    );
    const categoryCaseStyles = [
        { id: 5, name: "Cinematic Portrait", generationType: "image" as const, coverUrl: "https://example.com/portrait.jpg", category: "Cinematic" },
        { id: 6, name: "Cinematic Street", generationType: "image" as const, coverUrl: "https://example.com/street.jpg", category: "cinematic" },
    ];
    assert.deepEqual(collectGenerationStyleCategories(categoryCaseStyles), ["Cinematic"]);
    assert.deepEqual(
        filterGenerationStyles(categoryCaseStyles, "", "Cinematic").map((style) => style.id),
        [5, 6],
    );
});

test("默认封面和键盘高亮项有稳定结果", () => {
    assert.equal(usesGenerationStyleDefaultCover(styles[2]), true);
    assert.equal(usesGenerationStyleDefaultCover(styles[0]), false);
    assert.equal(isGenerationStyleSelected(2, [styles[1]]), true);
    assert.equal(isGenerationStyleSelected(3, [styles[1]]), false);
    assert.equal(generationStyleAt(styles, 99)?.id, 4);
    assert.equal(generationStyleAt([], 0), undefined);
});
