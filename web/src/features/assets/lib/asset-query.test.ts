import assert from "node:assert/strict";
import test from "node:test";

import type { Asset } from "../stores/use-asset-store.ts";
import { paginateAssets, queryAssets } from "./asset-query.ts";

const assets: Asset[] = [
    {
        id: "text-1",
        kind: "text",
        title: "品牌文案",
        coverUrl: "",
        tags: ["营销"],
        source: "画布",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        data: { content: "夏日新品介绍" },
    },
    {
        id: "image-1",
        kind: "image",
        title: "产品主图",
        coverUrl: "image:cover",
        tags: ["电商"],
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        data: { dataUrl: "image:data", width: 1024, height: 1024, bytes: 100, mimeType: "image/png" },
    },
];

test("素材查询同时支持类型、标题、标签和文本内容", () => {
    assert.deepEqual(queryAssets(assets, { keyword: "夏日", kind: "text" }).map((asset) => asset.id), ["text-1"]);
    assert.deepEqual(queryAssets(assets, { keyword: "电商", kind: "all" }).map((asset) => asset.id), ["image-1"]);
});

test("素材分页会把页码限制在有效范围", () => {
    const page = paginateAssets(assets, 9, 1);
    assert.equal(page.page, 2);
    assert.equal(page.totalPages, 2);
    assert.deepEqual(page.items.map((asset) => asset.id), ["image-1"]);
});
