import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig } from "@/features/settings/stores/use-config-store";
import type { CanvasStoryboardNode } from "../types.ts";
import { createStoryboardAssetGenerationState, readStoryboardAssetGenerationProgress, readStoryboardAssetImageCost, readStoryboardModelCost, readStoryboardShotReferenceImages, readStoryboardVideoCost, readStoryboardVideoReferenceIssue, readStoryboardVideoShotIssue, removeStoryboardAssetAndAssociations, STORYBOARD_ASSET_KIND_LABELS, STORYBOARD_SHOT_SIZES } from "./storyboard.ts";

test("分镜景别覆盖十种标准选项", () => {
    assert.equal(STORYBOARD_SHOT_SIZES.length, 10);
    assert.deepEqual(STORYBOARD_SHOT_SIZES.map((item) => item.value), ["大特写", "特写", "近景", "头肩景", "中景", "中远景", "全景", "远景", "大远景", "大全景"]);
    assert.equal(STORYBOARD_ASSET_KIND_LABELS.character, "角色");
    assert.equal(STORYBOARD_ASSET_KIND_LABELS.scene, "场景");
    assert.equal(STORYBOARD_ASSET_KIND_LABELS.prop, "道具");
});

test("分镜费用只读取已选文本模型的按次单价", () => {
    const modelCosts = [
        { model: "channel-1::text-model", taskType: "text", credits: 3 },
        { model: "channel-1::image-model", taskType: "image", credits: 8 },
    ];

    assert.equal(readStoryboardModelCost(modelCosts, "channel-1::text-model"), 3);
    assert.equal(readStoryboardModelCost(modelCosts, "channel-1::image-model"), 0);
    assert.equal(readStoryboardModelCost(modelCosts, "missing-model"), 0);
});

test("分镜资产图片费用按勾选数量乘图片模型单价计算", () => {
    const modelCosts = [{ model: "channel-1::image-model", taskType: "image", credits: 8 }];

    assert.equal(readStoryboardAssetImageCost(modelCosts, "channel-1::image-model", 3), 24);
    assert.equal(readStoryboardAssetImageCost(modelCosts, "missing-model", 3), 0);
    assert.equal(readStoryboardAssetImageCost(modelCosts, "channel-1::image-model", 0), 0);
});

test("分镜视频费用按模型计费单位逐镜头累计", () => {
    const shots: CanvasStoryboardNode["storyboard"]["shots"] = [
        { id: "shot-1", shotNumber: 1, durationSeconds: 4, visualDescription: "雨夜街道", shotSize: "远景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头一", assetIds: [] },
        { id: "shot-2", shotNumber: 2, durationSeconds: 6, visualDescription: "侦探回头", shotSize: "近景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头二", assetIds: [] },
    ];

    assert.equal(readStoryboardVideoCost([{ model: "video-generation", taskType: "video", credits: 3, unit: "generation" }], "video-generation", shots), 6);
    assert.equal(readStoryboardVideoCost([{ model: "video-second", taskType: "video", credits: 2, unit: "second" }], "video-second", shots), 20);
});

test("分镜视频只允许已合成提示词且满足模型时长的镜头", () => {
    const config = { ...defaultConfig, model: "video-model", videoModel: "video-model" };
    const shot = { id: "shot-1", shotNumber: 1, durationSeconds: 5, visualDescription: "雨夜街道", shotSize: "远景" as const, lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "最终提示词", assetIds: [] };

    assert.equal(readStoryboardVideoShotIssue(shot, config), "");
    assert.equal(readStoryboardVideoShotIssue({ ...shot, finalPrompt: "" }, config), "请先生成最终提示词");
    assert.equal(readStoryboardVideoShotIssue({ ...shot, durationSeconds: 16 }, config), "当前模型仅支持 1-15 秒视频");
});

test("分镜视频只携带镜头关联且已有图片的资产参考图", () => {
    const shot: CanvasStoryboardNode["storyboard"]["shots"][number] = {
        id: "shot-1",
        shotNumber: 1,
        durationSeconds: 5,
        visualDescription: "雨夜街道上的侦探",
        shotSize: "近景",
        lightingAtmosphere: "",
        dialogueVoiceover: "",
        soundEffect: "",
        cameraMovement: "",
        finalPrompt: "最终提示词",
        assetIds: ["character-1", "scene-1", "character-1", "missing"],
    };
    const references = readStoryboardShotReferenceImages(shot, [
        { id: "character-1", kind: "character", name: "侦探", description: "黑色风衣", image: { source: "https://example.com/detective.webp", storageKey: "image:detective", mimeType: "image/webp" } },
        { id: "scene-1", kind: "scene", name: "雨夜街道", description: "潮湿路面" },
    ]);

    assert.deepEqual(references.map((reference) => ({ id: reference.id, name: reference.name, type: reference.type, dataUrl: reference.dataUrl, storageKey: reference.storageKey })), [
        { id: "character-1", name: "角色-侦探", type: "image/webp", dataUrl: "https://example.com/detective.webp", storageKey: "image:detective" },
    ]);
});

test("分镜视频参考图保持镜头资产关联顺序", () => {
    const shot: CanvasStoryboardNode["storyboard"]["shots"][number] = {
        id: "shot-1",
        shotNumber: 1,
        durationSeconds: 5,
        visualDescription: "角色走入雨夜街道",
        shotSize: "中景",
        lightingAtmosphere: "",
        dialogueVoiceover: "",
        soundEffect: "",
        cameraMovement: "",
        finalPrompt: "最终提示词",
        assetIds: ["scene-1", "character-1", "prop-1"],
    };
    const references = readStoryboardShotReferenceImages(shot, [
        { id: "character-1", kind: "character", name: "侦探", description: "黑色风衣", image: { source: "https://example.com/detective.webp" } },
        { id: "prop-1", kind: "prop", name: "手电筒", description: "金属手电筒", image: { source: "https://example.com/flashlight.webp" } },
        { id: "scene-1", kind: "scene", name: "雨夜街道", description: "潮湿路面", image: { source: "https://example.com/street.webp" } },
    ]);

    assert.deepEqual(references.map((reference) => reference.id), ["scene-1", "character-1", "prop-1"]);
});

test("Agnes 视频拒绝超过三张已出图的关联资产", () => {
    const shot: CanvasStoryboardNode["storyboard"]["shots"][number] = {
        id: "shot-1",
        shotNumber: 1,
        durationSeconds: 5,
        visualDescription: "镜头",
        shotSize: "中景",
        lightingAtmosphere: "",
        dialogueVoiceover: "",
        soundEffect: "",
        cameraMovement: "",
        finalPrompt: "最终提示词",
        assetIds: ["asset-1", "asset-2", "asset-3", "asset-4"],
    };
    const assets = shot.assetIds.map((id) => ({ id, kind: "character" as const, name: id, description: "", image: { source: `https://example.com/${id}.png` } }));
    const config = {
        ...defaultConfig,
        model: "agnes::agnes-video-v2.0",
        videoModel: "agnes::agnes-video-v2.0",
        channels: [{ id: "agnes", name: "Agnes", baseUrl: "https://example.com", apiKey: "key", apiFormat: "agnes" as const, models: ["agnes-video-v2.0"] }],
    };

    assert.equal(readStoryboardVideoReferenceIssue({ ...shot, assetIds: shot.assetIds.slice(0, 3) }, assets, config), "");
    assert.match(readStoryboardVideoReferenceIssue(shot, assets, config), /最多支持3张参考图片/);
});

test("分镜资产批量生成状态保存任务前的待生成清单并计算进度", () => {
    const state = createStoryboardAssetGenerationState(
        ["asset-1", "asset-2"],
        { model: "image-model", quality: "high", imageResolution: "2K", size: "16:9" },
        "2026-08-09T00:00:00.000Z",
    );

    assert.deepEqual(state.selectedAssetIds, ["asset-1", "asset-2"]);
    assert.deepEqual(state.statuses, { "asset-1": "pending", "asset-2": "pending" });
    assert.equal(state.progress, 0);
    assert.equal(readStoryboardAssetGenerationProgress({ ...state, statuses: { "asset-1": "succeeded", "asset-2": "failed" } }), 100);
});

test("删除分镜资产会同步清理所有镜头关联", () => {
    const storyboard: CanvasStoryboardNode["storyboard"] = {
        shots: [
            { id: "shot-1", shotNumber: 1, durationSeconds: 5, visualDescription: "雨夜街道", shotSize: "远景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "", assetIds: ["asset-1", "asset-2"] },
            { id: "shot-2", shotNumber: 2, durationSeconds: 5, visualDescription: "侦探回头", shotSize: "近景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "", assetIds: ["asset-1"] },
        ],
        assets: [
            { id: "asset-1", kind: "character", name: "侦探", description: "黑色风衣" },
            { id: "asset-2", kind: "scene", name: "雨夜街道", description: "潮湿路面" },
        ],
    };

    const result = removeStoryboardAssetAndAssociations(storyboard, "asset-1");

    assert.deepEqual(result.assets.map((asset) => asset.id), ["asset-2"]);
    assert.deepEqual(result.shots.map((shot) => shot.assetIds), [["asset-2"], []]);
});
