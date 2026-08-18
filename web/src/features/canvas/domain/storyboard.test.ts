import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import type { CanvasStoryboardNode } from "../types";
import { createStoryboardAssetGenerationState, readStoryboardAssetGenerationProgress, readStoryboardAssetImageCost, readStoryboardModelCost, readStoryboardShotReferenceImages, readStoryboardVideoCost, readStoryboardVideoGenerationMode, readStoryboardVideoGenerationModes, readStoryboardVideoReferenceIssue, readStoryboardVideoResolutionOptions, readStoryboardVideoShotIssue, removeStoryboardAssetAndAssociations, STORYBOARD_ASSET_KIND_LABELS, STORYBOARD_SHOT_SIZES } from "./storyboard";

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

test("分镜视频费用按模式分辨率和计费单位逐镜头累计", () => {
    const shots: CanvasStoryboardNode["storyboard"]["shots"] = [
        { id: "shot-1", shotNumber: 1, durationSeconds: 4, visualDescription: "雨夜街道", shotSize: "远景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头一", assetIds: [] },
        { id: "shot-2", shotNumber: 2, durationSeconds: 6, visualDescription: "侦探回头", shotSize: "近景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头二", assetIds: [] },
    ];

    const config = storyboardVideoConfig({
        "video-generation": {
            capabilities: ["text-to-video"],
            billingUnit: "generation",
            prices: { auto: 3 },
        },
        "video-second": {
            capabilities: ["text-to-video"],
            billingUnit: "second",
            prices: { auto: 2 },
        },
    });
    const videoConfig = { ...config, vquality: "auto" };
    const generationQuote = readStoryboardVideoCost(config, "video-generation", videoConfig, shots, []);
    const secondQuote = readStoryboardVideoCost(config, "video-second", videoConfig, shots, []);
    assert.deepEqual(generationQuote, { available: true, credits: 6 });
    assert.deepEqual(secondQuote, { available: true, credits: 20 });
});

test("分镜按图片资产自动切换图生视频并累计各镜头价格", () => {
    const shots: CanvasStoryboardNode["storyboard"]["shots"] = [
        { id: "text-shot", shotNumber: 1, durationSeconds: 3, visualDescription: "无参考", shotSize: "中景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头一", assetIds: [] },
        { id: "image-shot", shotNumber: 2, durationSeconds: 4, visualDescription: "有参考", shotSize: "近景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头二", assetIds: ["asset-1"] },
    ];
    const assets = [{ id: "asset-1", kind: "character" as const, name: "角色", description: "", image: { source: "https://example.com/role.png" } }];
    const config = storyboardVideoConfig({
        "video-model": {
            capabilities: ["text-to-video", "image-to-video"],
            billingUnit: "generation",
            prices: { auto: 5 },
            imagePrices: { auto: 8 },
        },
    });
    assert.equal(readStoryboardVideoGenerationMode(shots[0], assets), "text-to-video");
    assert.equal(readStoryboardVideoGenerationMode(shots[1], assets), "image-to-video");
    assert.deepEqual(readStoryboardVideoCost(config, "video-model", { ...config, vquality: "auto" }, shots, assets), { available: true, credits: 13 });
});

test("分镜任一镜头缺少分档价格时整批不可报价", () => {
    const shot: CanvasStoryboardNode["storyboard"]["shots"][number] = {
        id: "shot-1", shotNumber: 1, durationSeconds: 3, visualDescription: "镜头", shotSize: "中景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "最终提示词", assetIds: [],
    };
    const config = storyboardVideoConfig({
        "video-model": { capabilities: ["text-to-video"], billingUnit: "generation", prices: {} },
    });
    const quote = readStoryboardVideoCost(config, "video-model", { ...config, vquality: "720p" }, [shot], []);
    assert.equal(quote.available, false);
    if (!quote.available) assert.match(quote.reason, /未配置所选分辨率价格/);
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

type StoryboardVideoDefinition = {
    capabilities: string[];
    billingUnit: "generation" | "second";
    prices: Record<string, number>;
    imagePrices?: Record<string, number>;
    referencePrices?: Record<string, number>;
};

function storyboardVideoConfig(definitions: Record<string, StoryboardVideoDefinition>): AiConfig {
    return {
        ...defaultConfig,
        videoModels: Object.keys(definitions),
        videoModel: Object.keys(definitions)[0] || "",
        videoModelBillingConfigurations: Object.entries(definitions).map(([model, definition]) => ({
            model,
            capabilities: definition.capabilities,
            videoBillingConfiguration: {
                billingUnit: definition.billingUnit,
                minimumDurationSeconds: 3,
                modePrices: {
                    "text-to-video": definition.prices,
                    "image-to-video": definition.imagePrices || {},
                    "reference-to-video": definition.referencePrices || {},
                },
            },
        })),
    };
}

test("分镜按视频参考自动切换全能参考并携带参考数量报价", () => {
    const shot: CanvasStoryboardNode["storyboard"]["shots"][number] = {
        id: "video-shot", shotNumber: 1, durationSeconds: 4, visualDescription: "有视频参考", shotSize: "中景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头一", assetIds: [],
    };
    const referenceVideos = [{ id: "video-1", name: "参考视频.mp4", type: "video/mp4", url: "https://example.com/reference.mp4" }];
    const config = storyboardVideoConfig({
        "video-model": {
            capabilities: ["text-to-video", "image-to-video", "reference-to-video"],
            billingUnit: "generation",
            prices: { auto: 5 },
            imagePrices: { auto: 8 },
            referencePrices: { auto: 12 },
        },
    });
    assert.equal(readStoryboardVideoGenerationMode(shot, [], referenceVideos), "reference-to-video");
    assert.deepEqual(readStoryboardVideoCost(config, "video-model", { ...config, vquality: "auto" }, [shot], [], referenceVideos), { available: true, credits: 12 });
});

test("分镜图片与视频混合参考按全能参考判定并报价", () => {
    const shot: CanvasStoryboardNode["storyboard"]["shots"][number] = {
        id: "mixed-shot", shotNumber: 1, durationSeconds: 4, visualDescription: "混合参考", shotSize: "近景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头一", assetIds: ["asset-1"],
    };
    const assets = [{ id: "asset-1", kind: "character" as const, name: "角色", description: "", image: { source: "https://example.com/role.png" } }];
    const referenceVideos = [{ id: "video-1", name: "参考视频.mp4", type: "video/mp4", url: "https://example.com/reference.mp4" }];
    const config = storyboardVideoConfig({
        "video-model": {
            capabilities: ["text-to-video", "image-to-video", "reference-to-video"],
            billingUnit: "generation",
            prices: { auto: 5 },
            imagePrices: { auto: 8 },
            referencePrices: { auto: 12 },
        },
    });
    assert.equal(readStoryboardVideoGenerationMode(shot, assets, referenceVideos), "reference-to-video");
    assert.deepEqual(readStoryboardVideoGenerationModes([shot], assets, referenceVideos), ["reference-to-video"]);
    assert.deepEqual(readStoryboardVideoCost(config, "video-model", { ...config, vquality: "auto" }, [shot], assets, referenceVideos), { available: true, credits: 12 });
});

test("分镜批量视频参考应用到全部镜头并统一按全能参考报价", () => {
    const shots: CanvasStoryboardNode["storyboard"]["shots"] = [
        { id: "text-shot", shotNumber: 1, durationSeconds: 3, visualDescription: "无参考", shotSize: "中景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头一", assetIds: [] },
        { id: "image-shot", shotNumber: 2, durationSeconds: 4, visualDescription: "有图", shotSize: "近景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头二", assetIds: ["asset-1"] },
        { id: "video-shot", shotNumber: 3, durationSeconds: 5, visualDescription: "有视频", shotSize: "全景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头三", assetIds: [] },
    ];
    const assets = [{ id: "asset-1", kind: "scene" as const, name: "街道", description: "", image: { source: "https://example.com/street.png" } }];
    const referenceVideos = [{ id: "video-1", name: "参考视频.mp4", type: "video/mp4", url: "https://example.com/reference.mp4" }];
    const config = storyboardVideoConfig({
        "video-model": {
            capabilities: ["text-to-video", "image-to-video", "reference-to-video"],
            billingUnit: "generation",
            prices: { auto: 5 },
            imagePrices: { auto: 8 },
            referencePrices: { auto: 12 },
        },
    });
    assert.deepEqual(readStoryboardVideoGenerationModes(shots, assets, referenceVideos), ["reference-to-video"]);
    assert.deepEqual(readStoryboardVideoCost(config, "video-model", { ...config, vquality: "auto" }, shots, assets, referenceVideos), { available: true, credits: 36 });
});

test("分镜无视频参考时按各镜头图片参考分别判定模式", () => {
    const shots: CanvasStoryboardNode["storyboard"]["shots"] = [
        { id: "text-shot", shotNumber: 1, durationSeconds: 3, visualDescription: "无参考", shotSize: "中景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头一", assetIds: [] },
        { id: "image-shot", shotNumber: 2, durationSeconds: 4, visualDescription: "有图", shotSize: "近景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头二", assetIds: ["asset-1"] },
    ];
    const assets = [{ id: "asset-1", kind: "scene" as const, name: "街道", description: "", image: { source: "https://example.com/street.png" } }];
    const config = storyboardVideoConfig({
        "video-model": {
            capabilities: ["text-to-video", "image-to-video"],
            billingUnit: "generation",
            prices: { auto: 5 },
            imagePrices: { auto: 8 },
        },
    });
    assert.deepEqual(readStoryboardVideoGenerationModes(shots, assets), ["text-to-video", "image-to-video"]);
    assert.deepEqual(readStoryboardVideoCost(config, "video-model", { ...config, vquality: "auto" }, shots, assets), { available: true, credits: 13 });
});

test("分镜无参考素材时不会静默落入全能参考模式", () => {
    const shot: CanvasStoryboardNode["storyboard"]["shots"][number] = {
        id: "shot-1", shotNumber: 1, durationSeconds: 3, visualDescription: "镜头", shotSize: "中景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "最终提示词", assetIds: [],
    };
    const config = storyboardVideoConfig({
        "video-model": { capabilities: ["reference-to-video"], billingUnit: "generation", prices: {}, referencePrices: { auto: 12 } },
    });
    const quote = readStoryboardVideoCost(config, "video-model", { ...config, vquality: "auto" }, [shot], []);
    assert.equal(quote.available, false);
    if (!quote.available) assert.match(quote.reason, /未配置所选视频生成模式/);
});

test("分镜分辨率选项取全部镜头模式的价格交集", () => {
    const shots: CanvasStoryboardNode["storyboard"]["shots"] = [
        { id: "text-shot", shotNumber: 1, durationSeconds: 3, visualDescription: "无参考", shotSize: "中景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头一", assetIds: [] },
        { id: "image-shot", shotNumber: 2, durationSeconds: 4, visualDescription: "有图", shotSize: "近景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头二", assetIds: ["asset-1"] },
        { id: "video-shot", shotNumber: 3, durationSeconds: 5, visualDescription: "有视频", shotSize: "全景", lightingAtmosphere: "", dialogueVoiceover: "", soundEffect: "", cameraMovement: "", finalPrompt: "镜头三", assetIds: [] },
    ];
    const assets = [{ id: "asset-1", kind: "scene" as const, name: "街道", description: "", image: { source: "https://example.com/street.png" } }];
    const referenceVideos = [{ id: "video-1", name: "参考视频.mp4", type: "video/mp4", url: "https://example.com/reference.mp4" }];
    const config = storyboardVideoConfig({
        "video-model": {
            capabilities: ["text-to-video", "image-to-video", "reference-to-video"],
            billingUnit: "generation",
            prices: { auto: 5, "720p": 6 },
            imagePrices: { auto: 8, "720p": 9 },
            referencePrices: { auto: 12 },
        },
    });
    assert.deepEqual(readStoryboardVideoResolutionOptions(config, "video-model", shots, assets, referenceVideos), ["auto"]);
});
