import test from "node:test";
import assert from "node:assert/strict";

import { applyCustomConfigCopy, countCustomConfigFields, countCustomGroupFields, copyableVideoSourceModels, isCustomGroupBlank, planCustomConfigCopy } from "./model-config-copy";

const emptyGroup = () => ({
    requestPath: "",
    requestMethod: "POST",
    requestModelName: "",
    requestTemplate: "",
    aiRequestPrompt: "",
    responseExample: "",
    resultPath: "",
    queryPath: "",
    queryMethod: "POST",
    queryRequestTemplate: "",
    aiQueryPrompt: "",
    queryResponseExample: "",
    queryResultPath: "",
});

const group = (patch) => ({ ...emptyGroup(), ...patch });

const config = (patch) => ({
    id: "id",
    channelId: "channel-1",
    modelName: "model-a",
    modelType: "video",
    capabilities: [],
    defaultModel: false,
    sortOrder: 0,
    creditCost: "0",
    creditUnit: "run",
    thinkingEnabled: false,
    reasoningEffort: "high",
    requestConcurrency: 1,
    convertImageSizeToPixels: false,
    imageSizeMappings: null,
    customBodyParameters: {},
    videoBillingConfiguration: null,
    imageBillingConfiguration: null,
    displayName: null,
    modelIcon: null,
    isCustomModel: true,
    customModelConfig: {},
    ...patch,
});

test("复制来源排除自身与非自定义视频模型", () => {
    const target = config({});
    const sources = copyableVideoSourceModels(
        [
            config({ id: "1", modelName: "model-a" }),
            config({ id: "2", modelName: "model-b" }),
            config({ id: "3", modelName: "model-c", isCustomModel: false }),
            config({ id: "4", modelName: "model-d", modelType: "image" }),
            config({ id: "5", modelName: "model-e", channelId: "channel-2" }),
        ],
        target,
    );
    assert.deepEqual(sources.map((item) => item.id), ["2", "5"]);
});

test("空白分组按未填写处理，方法默认值不计入字段数", () => {
    assert.equal(countCustomGroupFields(emptyGroup()), 0);
    assert.equal(isCustomGroupBlank(group({ requestMethod: "GET" })), true);
    assert.equal(countCustomGroupFields(group({ requestPath: "/v1/video" })), 1);
    assert.equal(countCustomConfigFields(config({ customModelConfig: { "text-to-video": group({ requestPath: "/a", requestTemplate: "{}" }) } })), 2);
});

test("复制覆盖目标已有内容，并同步开启对应能力", () => {
    const target = config({ capabilities: [], customModelConfig: { "text-to-video": group({ requestPath: "/old" }) } });
    const source = config({ modelName: "model-b", capabilities: ["text-to-video"], customModelConfig: { "text-to-video": group({ requestPath: "/new", requestTemplate: "{}" }) } });

    const { config: next, copiedModes, overwrittenModes } = applyCustomConfigCopy(target, source, ["text-to-video"]);
    assert.deepEqual(copiedModes, ["text-to-video"]);
    assert.deepEqual(overwrittenModes, ["text-to-video"]);
    assert.equal(next.customModelConfig["text-to-video"].requestPath, "/new");
    assert.ok(next.capabilities.includes("text-to-video"));
});

test("来源未填写的模式不复制，也不改动目标原值", () => {
    const target = config({ capabilities: ["text-to-video"], customModelConfig: { "text-to-video": group({ requestPath: "/keep" }) } });
    const source = config({ modelName: "model-b", capabilities: ["text-to-video"], customModelConfig: { "text-to-video": group({ requestPath: "/new" }) } });

    const { config: next, copiedModes } = applyCustomConfigCopy(target, source, ["image-to-video"]);
    assert.deepEqual(copiedModes, []);
    assert.equal(next.customModelConfig["text-to-video"].requestPath, "/keep");
});

test("复制不改动价格、计费单位与并发数", () => {
    const billing = { billingUnit: "second", minimumDurationSeconds: 9, modePrices: { "text-to-video": { "720p": "3" } } };
    const target = config({ videoBillingConfiguration: billing, requestConcurrency: 4 });
    const source = config({
        modelName: "model-b",
        videoBillingConfiguration: { billingUnit: "run", minimumDurationSeconds: 1, modePrices: { "text-to-video": { "480p": "1" } } },
        customModelConfig: { "text-to-video": group({ requestPath: "/new" }) },
    });

    const { config: next } = applyCustomConfigCopy(target, source, ["text-to-video"]);
    assert.deepEqual(next.videoBillingConfiguration, billing);
    assert.equal(next.requestConcurrency, 4);
});

test("复制全能参考时来源的音频输入开关一并开启", () => {
    const target = config({ capabilities: [] });
    const source = config({ modelName: "model-b", capabilities: ["reference-to-video", "audio-input"], customModelConfig: { "reference-to-video": group({ requestPath: "/ref" }) } });

    const { config: next } = applyCustomConfigCopy(target, source, ["reference-to-video"]);
    assert.ok(next.capabilities.includes("reference-to-video"));
    assert.ok(next.capabilities.includes("audio-input"));
});

test("来源未开启音频输入时不擅自开启目标开关", () => {
    const target = config({ capabilities: [] });
    const source = config({ modelName: "model-b", capabilities: ["reference-to-video"], customModelConfig: { "reference-to-video": group({ requestPath: "/ref" }) } });

    const { config: next } = applyCustomConfigCopy(target, source, ["reference-to-video"]);
    assert.ok(!next.capabilities.includes("audio-input"));
});

test("逐模式计划给出来源与目标的填写字段", () => {
    const target = config({ customModelConfig: { "text-to-video": group({ requestPath: "/old", requestTemplate: "{}" }) } });
    const source = config({ modelName: "model-b", customModelConfig: { "text-to-video": group({ requestPath: "/new" }) } });

    const rows = planCustomConfigCopy(source, target);
    const textToVideo = rows.find((row) => row.mode === "text-to-video");
    assert.equal(textToVideo.sourceFilledFieldCount, 1);
    assert.equal(textToVideo.targetFilledFieldCount, 2);
    assert.deepEqual(textToVideo.sourceFilledFields, ["requestPath"]);
    assert.deepEqual(textToVideo.targetFilledFields, ["requestPath", "requestTemplate"]);
});
