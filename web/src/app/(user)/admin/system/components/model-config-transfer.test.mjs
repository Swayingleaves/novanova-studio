import test from "node:test";
import assert from "node:assert/strict";

import { buildCustomModelTransferJson, parseCustomModelTransfer } from "./model-config-transfer";

const group = (patch = {}) => ({
    requestPath: "",
    requestMethod: "POST",
    requestModelName: "",
    requestTemplate: "",
    aiRequestPrompt: "",
    responseExample: "",
    resultPath: "",
    queryPath: "",
    queryMethod: "GET",
    queryRequestTemplate: "",
    aiQueryPrompt: "",
    queryResponseExample: "",
    queryResultPath: "",
    ...patch,
});

const videoConfig = (patch = {}) => ({
    id: "id",
    channelId: "channel-1",
    modelName: "video-a",
    modelType: "video",
    capabilities: ["text-to-video", "image-to-video"],
    defaultModel: false,
    enabled: true,
    sortOrder: 0,
    creditCost: "0",
    creditUnit: "second",
    thinkingEnabled: true,
    reasoningEffort: "high",
    requestConcurrency: 3,
    convertImageSizeToPixels: false,
    imageSizeMappings: null,
    customBodyParameters: { seed: 1 },
    videoBillingConfiguration: {
        billingUnit: "second",
        minimumDurationSeconds: 5,
        modePrices: {
            "text-to-video": { "720p": "3", "1080p": "6" },
            "image-to-video": { "720p": "4" },
        },
    },
    imageBillingConfiguration: null,
    displayName: "Video A",
    modelIcon: "seedance",
    isCustomModel: true,
    customModelConfig: {
        "text-to-video": group({ requestPath: "/v1/videos", requestTemplate: "{\"prompt\":\"{{prompt}}\"}", videoGenerationConstraints: { minimumDurationSeconds: 5, maximumDurationSeconds: 10, minimumImageCount: 0, maximumImageCount: 0, supportedAspectRatios: ["16:9", "auto"] } }),
        "image-to-video": group({ requestPath: "/v1/videos", asyncQuery: true, queryPath: "/v1/tasks/{{taskId}}" }),
        "reference-to-video": group({ requestPath: "/should-be-dropped" }),
    },
    ...patch,
});

const imageConfig = (patch = {}) => ({
    ...videoConfig(),
    modelType: "image",
    capabilities: ["text-to-image", "image-to-image"],
    creditUnit: "generation",
    creditCost: "2",
    convertImageSizeToPixels: true,
    imageSizeMappings: { "1:1": { "1K": "1024x1024", "2K": "2048x2048" } },
    videoBillingConfiguration: null,
    imageBillingConfiguration: { resolutionPrices: { "1K": "2", "2K": "5" } },
    customModelConfig: {
        "text-to-image": group({ requestPath: "/v1/images", asyncQuery: true, queryPath: "/v1/tasks/{{taskId}}" }),
    },
    ...patch,
});

test("视频配置导出后可以完整导入", () => {
    const json = buildCustomModelTransferJson(videoConfig());
    const parsed = JSON.parse(json);

    assert.equal(parsed.kind, "novanova-custom-model");
    assert.equal(parsed.channelId, undefined);
    assert.equal(parsed.modelName, undefined);
    assert.equal(parsed.enabled, undefined);

    const result = parseCustomModelTransfer(json, "video");
    assert.equal(result.ok, true);
    assert.deepEqual(result.patch.capabilities, ["text-to-video", "image-to-video"]);
    assert.equal(result.patch.displayName, "Video A");
    assert.equal(result.patch.modelIcon, "seedance");
    assert.equal(result.patch.requestConcurrency, 3);
    assert.equal(result.patch.creditUnit, "second");
    assert.equal(result.patch.videoBillingConfiguration.modePrices["text-to-video"]["1080p"], "6");
    assert.equal(result.patch.customModelConfig["text-to-video"].requestPath, "/v1/videos");
    assert.equal(result.patch.customModelConfig["image-to-video"].asyncQuery, true);
    assert.equal(result.patch.customModelConfig["text-to-video"].videoGenerationConstraints.maximumDurationSeconds, 10);
    assert.deepEqual(result.patch.customBodyParameters, { seed: 1 });
    assert.equal(result.summary.capabilityCount, 2);
    assert.equal(result.summary.priceCount, 3);
    assert.equal(result.summary.customModeCount, 2);
});

test("未启用能力的自定义配置不会导入", () => {
    const result = parseCustomModelTransfer(buildCustomModelTransferJson(videoConfig({ capabilities: ["text-to-video"] })), "video");
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.patch.customModelConfig), ["text-to-video"]);
    assert.equal(result.patch.videoBillingConfiguration.modePrices["image-to-video"], undefined);
});

test("全能参考有视频输入价格支持导出和导入，未启用全能参考时自动忽略", () => {
    const enabled = videoConfig({
        capabilities: ["text-to-video", "reference-to-video"],
        videoBillingConfiguration: {
            billingUnit: "generation",
            minimumDurationSeconds: 5,
            modePrices: { "text-to-video": { "720p": "10" }, "reference-to-video": { "720p": "55" } },
            referenceVideoInputPrices: { "720p": "75" },
        },
    });
    const imported = parseCustomModelTransfer(buildCustomModelTransferJson(enabled), "video");
    assert.equal(imported.ok, true);
    assert.equal(imported.patch.videoBillingConfiguration.referenceVideoInputPrices["720p"], "75");
    assert.equal(imported.summary.priceCount, 3);

    const disabled = parseCustomModelTransfer(buildCustomModelTransferJson({ ...enabled, capabilities: ["text-to-video"] }), "video");
    assert.equal(disabled.ok, true);
    assert.deepEqual(disabled.patch.videoBillingConfiguration.referenceVideoInputPrices, {});
});

test("图片配置保留尺寸映射与异步查询开关", () => {
    const result = parseCustomModelTransfer(buildCustomModelTransferJson(imageConfig()), "image");
    assert.equal(result.ok, true);
    assert.equal(result.patch.creditCost, "2");
    assert.equal(result.patch.imageBillingConfiguration.resolutionPrices["2K"], "5");
    assert.deepEqual(result.patch.imageSizeMappings["1:1"], { "1K": "1024x1024", "2K": "2048x2048" });
    assert.equal(result.patch.customModelConfig["text-to-image"].asyncQuery, true);
    assert.equal(result.patch.videoBillingConfiguration, null);
});

test("模型类型不匹配时拒绝导入", () => {
    const result = parseCustomModelTransfer(buildCustomModelTransferJson(videoConfig()), "image");
    assert.equal(result.ok, false);
    assert.equal(result.issue, "model-type-mismatch");
    assert.equal(result.actualType, "video");
});

test("非法 JSON 与错误结构给出明确失败原因", () => {
    assert.equal(parseCustomModelTransfer("", "video").issue, "empty");
    assert.equal(parseCustomModelTransfer("{oops", "video").issue, "invalid-json");
    assert.equal(parseCustomModelTransfer("[]", "video").issue, "invalid-payload");
    assert.equal(parseCustomModelTransfer(JSON.stringify({ modelType: "video" }), "video").issue, "invalid-payload");
    assert.equal(parseCustomModelTransfer(JSON.stringify({ modelType: "video", capabilities: [], customModelConfig: {} }), "video").issue, "invalid-payload");
    assert.equal(parseCustomModelTransfer(JSON.stringify({ kind: "other", modelType: "video", capabilities: [], customModelConfig: {} }), "video").issue, "invalid-payload");
});
