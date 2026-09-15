import assert from "node:assert/strict";
import test from "node:test";

import type { Asset } from "../../assets/stores/use-asset-store.ts";
import { createAudioNode, createBackgroundNode, createImageNode, createStoryboardNode, createTextNode, createVideoCompositionNode, createVideoNode } from "../constants.ts";
import type { CanvasNode, CanvasStoryboardAsset, CanvasStoryboardShot } from "../types.ts";
import {
    CANVAS_NAVIGATION_ASSET_CATEGORY_OPTIONS,
    CANVAS_NAVIGATION_NODE_CATEGORY_OPTIONS,
    canvasNavigationAssetKindLabel,
    canvasNavigationAssetTitle,
    canvasNavigationCategoryLabel,
    queryCanvasNavigationAssets,
    queryCanvasNavigationNodes,
    type CanvasNavigationAsset,
    type CanvasNavigationAssetCategory,
    type CanvasNavigationNodeCategory,
    type CanvasNavigationNodeResult,
} from "./canvas-navigation-query.ts";

function nodeResultIds(results: CanvasNavigationNodeResult[]) {
    return results.flatMap((result) => (result.type === "background" ? [result.board.id, ...result.members.map((member) => member.id)] : [result.node.id]));
}

function storyboardShot(id: string, overrides: Partial<CanvasStoryboardShot> = {}): CanvasStoryboardShot {
    return { id, shotNumber: 1, durationSeconds: 3, visualDescription: "", shotSize: "中景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "", assetIds: [], ...overrides };
}

function libraryAsset(input: { id: string; kind: Asset["kind"]; title: string; tags?: string[]; source?: string; note?: string; content?: string }): CanvasNavigationAsset {
    const base = { id: input.id, title: input.title, coverUrl: "", tags: input.tags || [], source: input.source, note: input.note, createdAt: "", updatedAt: "" };
    if (input.kind === "text") return { id: input.id, source: "library", asset: { ...base, kind: "text", data: { content: input.content || "" } } };
    if (input.kind === "image") return { id: input.id, source: "library", asset: { ...base, kind: "image", data: { dataUrl: "", width: 1, height: 1, bytes: 0, mimeType: input.content || "image/png" } } };
    return { id: input.id, source: "library", asset: { ...base, kind: "video", data: { url: "", width: 1, height: 1, bytes: 0, mimeType: input.content || "video/mp4" } } };
}

function storyboardAsset(input: { id: string; name: string; storyboardNodeTitle: string; kind?: CanvasStoryboardAsset["kind"]; description?: string }): CanvasNavigationAsset {
    return { id: input.id, source: "storyboard", storyboardNodeTitle: input.storyboardNodeTitle, asset: { id: input.id, kind: input.kind || "character", name: input.name, description: input.description || "" } };
}

function baseNodes(): CanvasNode[] {
    const text = createTextNode({ id: "node-text", position: { x: 0, y: 0 }, title: "旁白脚本", text: "夜晚的古镇街道" });
    const image = createImageNode({ id: "node-image", position: { x: 400, y: 0 } });
    image.generation.prompt = "细雨中的石板路";
    const video = createVideoNode({ id: "node-video", position: { x: 800, y: 0 } });
    const composition = createVideoCompositionNode({ id: "node-composition", position: { x: 1200, y: 0 } });
    return [text, image, video, composition];
}

test("无条件时保留普通节点原有顺序", () => {
    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes(baseNodes(), "", "all")), ["node-text", "node-image", "node-video", "node-composition"]);
});

test("节点分类与关键词取交集", () => {
    const nodes = [...baseNodes(), createAudioNode({ id: "node-audio", position: { x: 1600, y: 0 } })];
    const expectedByCategory: Record<CanvasNavigationNodeCategory, string[]> = {
        all: ["node-text", "node-image", "node-video", "node-composition", "node-audio"],
        text: ["node-text"],
        image: ["node-image"],
        video: ["node-video"],
        audio: ["node-audio"],
        storyboard: [],
        videoComposition: ["node-composition"],
        background: [],
    };

    for (const [category, expected] of Object.entries(expectedByCategory)) {
        assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes(nodes, "", category as CanvasNavigationNodeCategory)), expected, category);
    }
    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes(nodes, "石板路", "all")), ["node-image"]);
    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes(nodes, "石板路", "video")), []);
});

test("关键词去除首尾空格并按中文区域规则忽略大小写", () => {
    const storyboard = createStoryboardNode({ id: "node-storyboard", position: { x: 0, y: 0 } });
    storyboard.storyboard.shots.push(storyboardShot("shot-1", { finalPrompt: "Slow Dolly In" }));

    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes([storyboard], "  slow dolly in  ", "all")), ["node-storyboard"]);
    assert.equal(queryCanvasNavigationNodes([storyboard], "   ", "all").length, 1);
});

test("文本正文、图片与视频提示词参与匹配", () => {
    const nodes = baseNodes();
    const video = nodes[2];
    if (video.kind === "video") video.generation.prompt = "黄昏的屋顶";

    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes(nodes, "古镇街道", "all")), ["node-text"]);
    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes(nodes, "石板路", "all")), ["node-image"]);
    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes(nodes, "黄昏的屋顶", "all")), ["node-video"]);
});

test("分镜指令、视觉风格、镜头描述、对白、音效、运镜、最终提示词与分镜资产描述参与匹配", () => {
    const storyboard = createStoryboardNode({ id: "node-storyboard", position: { x: 0, y: 0 } });
    storyboard.content.instruction = "封面镜头";
    storyboard.content.visualStyle = "赛博朋克霓虹";
    storyboard.storyboard.shots.push(storyboardShot("shot-1", { visualDescription: "主角推开门", dialogueVoiceover: "我们到了", soundEffect: "雨声", cameraMovement: "固定镜头", finalPrompt: "低角度仰拍" }));
    storyboard.storyboard.assets.push({ id: "asset-character", kind: "character", name: "杨光", description: "幸存者" });

    for (const keyword of ["封面镜头", "霓虹", "推开门", "我们到了", "雨声", "固定镜头", "仰拍", "幸存者"]) {
        assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes([storyboard], keyword, "all")), ["node-storyboard"], keyword);
    }
});

test("音频与视频合成没有正文时按标题和类型匹配", () => {
    const audio = createAudioNode({ id: "node-audio", position: { x: 0, y: 0 }, title: "片尾配乐" });
    const composition = createVideoCompositionNode({ id: "node-composition", position: { x: 400, y: 0 } });

    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes([audio, composition], "片尾", "all")), ["node-audio"]);
    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes([audio, composition], "视频合成", "all")), ["node-composition"]);
    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes([audio, composition], "音频", "all")), ["node-audio"]);
});

test("无条件时保留背景板完整层级", () => {
    const member = createTextNode({ id: "node-member", position: { x: 0, y: 0 }, text: "石板路" });
    const other = createImageNode({ id: "node-other", position: { x: 400, y: 0 } });
    const board = createBackgroundNode({ id: "node-board", position: { x: -40, y: -40 }, memberNodeIds: [member.id] });
    const results = queryCanvasNavigationNodes([board, member, other], "", "all");

    assert.deepEqual(nodeResultIds(results), ["node-board", "node-member", "node-other"]);
});

test("成员节点命中时保留背景板层级且只返回命中的成员", () => {
    const member = createTextNode({ id: "node-member", position: { x: 0, y: 0 }, text: "细雨中的石板路" });
    const other = createTextNode({ id: "node-other-member", position: { x: 200, y: 0 }, text: "晴天的屋顶" });
    const board = createBackgroundNode({ id: "node-board", position: { x: -40, y: -40 }, memberNodeIds: [member.id, other.id] });

    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes([board, member, other], "石板路", "all")), ["node-board", "node-member"]);
});

test("仅背景板自身命中时不带入未命中的成员", () => {
    const member = createTextNode({ id: "node-member", position: { x: 0, y: 0 }, text: "晴天的屋顶" });
    const board = createBackgroundNode({ id: "node-board", position: { x: -40, y: -40 }, title: "古镇场景", memberNodeIds: [member.id] });

    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes([board, member], "古镇场景", "all")), ["node-board"]);
    assert.deepEqual(nodeResultIds(queryCanvasNavigationNodes([board, member], "", "background")), ["node-board"]);
});

test("无命中时返回空结果", () => {
    const nodes = baseNodes();

    assert.deepEqual(queryCanvasNavigationNodes(nodes, "不存在的关键词", "all"), []);
    assert.deepEqual(queryCanvasNavigationNodes(nodes, "古镇", "video"), []);
    assert.deepEqual(queryCanvasNavigationNodes([], "古镇", "all"), []);
});

test("资产库条目匹配标题、来源、备注、标签、文本正文与媒体类型", () => {
    const assets: CanvasNavigationAsset[] = [
        libraryAsset({ id: "asset-title", kind: "image", title: "古镇参考图" }),
        libraryAsset({ id: "asset-source", kind: "image", title: "素材", source: "本地导入" }),
        libraryAsset({ id: "asset-note", kind: "image", title: "素材", note: "需要重新抠图" }),
        libraryAsset({ id: "asset-tag", kind: "video", title: "素材", tags: ["空镜"] }),
        libraryAsset({ id: "asset-content", kind: "text", title: "素材", content: "夜晚的古镇街道" }),
        libraryAsset({ id: "asset-mime", kind: "video", title: "素材", content: "video/quicktime" }),
    ];

    assert.deepEqual(queryCanvasNavigationAssets(assets, "古镇参考", "all").map((asset) => asset.id), ["asset-title"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "本地导入", "all").map((asset) => asset.id), ["asset-source"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "抠图", "all").map((asset) => asset.id), ["asset-note"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "空镜", "all").map((asset) => asset.id), ["asset-tag"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "  古镇街道  ", "all").map((asset) => asset.id), ["asset-content"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "quicktime", "all").map((asset) => asset.id), ["asset-mime"]);
});

test("资产分类同时覆盖资产库与分镜资产且与关键词取交集", () => {
    const assets: CanvasNavigationAsset[] = [
        libraryAsset({ id: "asset-image", kind: "image", title: "古镇参考图" }),
        libraryAsset({ id: "asset-text", kind: "text", title: "古镇文案", content: "石板路" }),
        storyboardAsset({ id: "asset-character", name: "杨光", storyboardNodeTitle: "分镜脚本" }),
        storyboardAsset({ id: "asset-scene", name: "古镇街道", storyboardNodeTitle: "分镜脚本", kind: "scene" }),
        storyboardAsset({ id: "asset-prop", name: "油纸伞", storyboardNodeTitle: "分镜脚本", kind: "prop" }),
    ];

    const expectedByCategory: Record<CanvasNavigationAssetCategory, string[]> = {
        all: ["asset-image", "asset-text", "asset-character", "asset-scene", "asset-prop"],
        text: ["asset-text"],
        image: ["asset-image"],
        video: [],
        character: ["asset-character"],
        scene: ["asset-scene"],
        prop: ["asset-prop"],
    };

    for (const [category, expected] of Object.entries(expectedByCategory)) {
        assert.deepEqual(queryCanvasNavigationAssets(assets, "", category as CanvasNavigationAssetCategory).map((asset) => asset.id), expected, category);
    }
    assert.deepEqual(queryCanvasNavigationAssets(assets, "古镇", "all").map((asset) => asset.id), ["asset-image", "asset-text", "asset-scene"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "古镇", "scene").map((asset) => asset.id), ["asset-scene"]);
});

test("分镜资产匹配名称、描述、类型与所属分镜标题", () => {
    const assets: CanvasNavigationAsset[] = [
        storyboardAsset({ id: "asset-name", name: "杨光", storyboardNodeTitle: "古镇分镜" }),
        storyboardAsset({ id: "asset-description", name: "道具", storyboardNodeTitle: "古镇分镜", kind: "prop", description: "油纸伞" }),
        storyboardAsset({ id: "asset-storyboard", name: "角色", storyboardNodeTitle: "古镇分镜" }),
    ];

    assert.deepEqual(queryCanvasNavigationAssets(assets, "杨光", "all").map((asset) => asset.id), ["asset-name"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "油纸伞", "all").map((asset) => asset.id), ["asset-description"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "道具", "all").map((asset) => asset.id), ["asset-description"]);
    assert.deepEqual(queryCanvasNavigationAssets(assets, "古镇分镜", "all").map((asset) => asset.id), ["asset-name", "asset-description", "asset-storyboard"]);
    assert.deepEqual(queryCanvasNavigationAssets([], "古镇", "all"), []);
});

test("分类文案与资产文案由查询模块统一提供", () => {
    assert.equal(canvasNavigationCategoryLabel(CANVAS_NAVIGATION_NODE_CATEGORY_OPTIONS, "videoComposition"), "视频合成");
    assert.equal(canvasNavigationCategoryLabel(CANVAS_NAVIGATION_ASSET_CATEGORY_OPTIONS, "prop"), "道具");
    assert.throws(() => canvasNavigationCategoryLabel(CANVAS_NAVIGATION_NODE_CATEGORY_OPTIONS, "unknown" as CanvasNavigationNodeCategory));

    assert.equal(canvasNavigationAssetTitle(libraryAsset({ id: "asset-image", kind: "image", title: "古镇参考图" })), "古镇参考图");
    assert.equal(canvasNavigationAssetTitle(libraryAsset({ id: "asset-empty", kind: "text", title: "" })), "未命名资产");
    assert.equal(canvasNavigationAssetTitle(storyboardAsset({ id: "asset-prop", name: "", storyboardNodeTitle: "分镜脚本" })), "未命名分镜资产");
    assert.equal(canvasNavigationAssetKindLabel(libraryAsset({ id: "asset-image", kind: "image", title: "古镇参考图" })), "图片");
    assert.equal(canvasNavigationAssetKindLabel(storyboardAsset({ id: "asset-prop", name: "油纸伞", storyboardNodeTitle: "古镇分镜", kind: "prop" })), "道具 · 古镇分镜");
    assert.equal(canvasNavigationAssetKindLabel(storyboardAsset({ id: "asset-scene", name: "街道", storyboardNodeTitle: "", kind: "scene" })), "场景 · 分镜脚本");
});
