import test from "node:test";
import assert from "node:assert/strict";

import { applyCustomConfigAutoFill, applyCustomConfigCopy, countCustomConfigFields, countCustomGroupFields, copyableCustomSourceModels, isCustomGroupBlank, planCustomConfigAutoFill, planCustomConfigCopy } from "./model-config-copy";

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

test("复制视频限制时深复制嵌套对象和比例数组", () => {
    const source = config({ customModelConfig: { "image-to-video": group({ videoGenerationConstraints: {
        minimumDurationSeconds: 3, maximumDurationSeconds: 10, minimumImageCount: 1, maximumImageCount: 2, supportedAspectRatios: ["16:9", "auto"],
    } }) } });
    const result = applyCustomConfigCopy(config({}), source, ["image-to-video"]);
    const copied = result.config.customModelConfig["image-to-video"].videoGenerationConstraints;
    copied.supportedAspectRatios.push("9:16");
    copied.maximumImageCount = 5;
    assert.deepEqual(source.customModelConfig["image-to-video"].videoGenerationConstraints.supportedAspectRatios, ["16:9", "auto"]);
    assert.equal(source.customModelConfig["image-to-video"].videoGenerationConstraints.maximumImageCount, 2);
});

test("复制来源排除自身与非自定义视频模型", () => {
    const target = config({});
    const sources = copyableCustomSourceModels(
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

test("自动填充只补当前模式的空字段，已有内容保持不变", () => {
    const target = config({ customModelConfig: { "image-to-video": group({ requestPath: "/keep", queryPath: "" }) } });
    const next = applyCustomConfigAutoFill(target, "image-to-video", group({ requestPath: "/new", requestTemplate: '{"a":1}', queryPath: "/q" }));

    assert.equal(next.config.customModelConfig["image-to-video"].requestPath, "/keep");
    assert.equal(next.config.customModelConfig["image-to-video"].requestTemplate, '{"a":1}');
    assert.equal(next.config.customModelConfig["image-to-video"].queryPath, "/q");
    assert.deepEqual(next.filledFields, ["requestTemplate", "queryPath"]);
});

test("自动填充逐项合并视频生成限制，空比例数组也算未填写", () => {
    const target = config({ customModelConfig: { "reference-to-video": group({ videoGenerationConstraints: { minimumDurationSeconds: 5, supportedAspectRatios: [] } }) } });
    const source = group({ videoGenerationConstraints: { minimumDurationSeconds: 2, maximumDurationSeconds: 8, supportedAspectRatios: ["16:9", "auto"] } });
    const next = applyCustomConfigAutoFill(target, "reference-to-video", source);
    const merged = next.config.customModelConfig["reference-to-video"].videoGenerationConstraints;

    assert.equal(merged.minimumDurationSeconds, 5);
    assert.equal(merged.maximumDurationSeconds, 8);
    assert.deepEqual(merged.supportedAspectRatios, ["16:9", "auto"]);
    assert.deepEqual(next.filledFields, ["videoGenerationConstraints"]);
});

test("自动填充计划排除当前模式，并跳过来源为空或目标已填满的模式", () => {
    const target = config({ customModelConfig: { "image-to-video": group({ requestPath: "/filled" }) } });
    const source = config({ customModelConfig: {
        "text-to-video": group({ requestPath: "/t2v" }),
        "image-to-video": group({ requestPath: "/keep-text" }),
        "reference-to-video": group({}),
    } });

    const rows = planCustomConfigAutoFill(target, source, "image-to-video");
    assert.deepEqual(rows.map((row) => row.mode), ["text-to-video", "reference-to-video", "first-last-frame-to-video"]);
    assert.deepEqual(rows.find((row) => row.mode === "text-to-video").fillableFields, []);
    assert.deepEqual(rows.find((row) => row.mode === "reference-to-video").sourceFilledFields, []);
});

test("自动填充计划在空目标下列出全部可填充字段", () => {
    const source = config({ customModelConfig: { "text-to-video": group({ requestPath: "/t2v", requestTemplate: "{}", videoGenerationConstraints: { maximumImageCount: 2 } }) } });
    const rows = planCustomConfigAutoFill(config({}), source, "reference-to-video");
    const textToVideo = rows.find((row) => row.mode === "text-to-video");
    assert.deepEqual(textToVideo.fillableFields, ["requestPath", "requestTemplate", "videoGenerationConstraints"]);
});

test("自动填充不改动其他模式，也不污染来源分组", () => {
    const sourceGroup = group({ requestTemplate: '{"a":1}' });
    const target = config({ customModelConfig: { "text-to-video": group({ requestPath: "/t2v" }) } });
    const next = applyCustomConfigAutoFill(target, "image-to-video", sourceGroup);
    next.config.customModelConfig["image-to-video"].requestTemplate = '{"b":2}';

    assert.equal(next.config.customModelConfig["text-to-video"].requestPath, "/t2v");
    assert.equal(sourceGroup.requestTemplate, '{"a":1}');
});

test("图片模型只复制文生图与图生图，并同步开启对应能力", () => {
    const target = config({ modelType: "image", capabilities: [], customModelConfig: {} });
    const source = config({
        id: "source",
        modelName: "image-a",
        modelType: "image",
        capabilities: ["text-to-image", "image-to-image"],
        customModelConfig: {
            "text-to-image": group({ requestPath: "/v1/images", requestTemplate: "{}" }),
            "image-to-image": group({ requestPath: "/v1/images/edit" }),
            "text-to-video": group({ requestPath: "/v1/videos" }),
        },
    });

    const { config: next, copiedModes } = applyCustomConfigCopy(target, source, ["text-to-image", "image-to-image"]);
    assert.deepEqual(copiedModes, ["text-to-image", "image-to-image"]);
    assert.deepEqual(next.capabilities, ["text-to-image", "image-to-image"]);
    assert.equal(next.customModelConfig["image-to-image"].requestPath, "/v1/images/edit");
    assert.equal(next.customModelConfig["text-to-video"], undefined);
});

test("图片模型的复制计划只包含图片能力", () => {
    const target = config({ modelType: "image" });
    const source = config({ modelName: "image-b", modelType: "image", customModelConfig: { "image-to-image": group({ requestPath: "/edit" }) } });
    const rows = planCustomConfigCopy(source, target);

    assert.deepEqual(rows.map((row) => row.mode), ["text-to-image", "image-to-image"]);
    assert.equal(rows.find((row) => row.mode === "image-to-image").sourceFilledFieldCount, 1);
});

test("图片模型的复制来源只列出同类型自定义模型", () => {
    const target = config({ modelType: "image", modelName: "image-a" });
    const sources = copyableCustomSourceModels([
        config({ id: "video", modelType: "video" }),
        config({ id: "self", modelType: "image", modelName: "image-a" }),
        config({ id: "plain", modelType: "image", modelName: "image-c", isCustomModel: false }),
        config({ id: "custom", modelType: "image", modelName: "image-d" }),
    ], target);

    assert.deepEqual(sources.map((item) => item.id), ["custom"]);
});

test("字段总数按模型类型统计，不会串到另一种类型", () => {
    const groups = { "text-to-video": group({ requestPath: "/v" }), "text-to-image": group({ requestPath: "/i", requestTemplate: "{}" }) };
    assert.equal(countCustomConfigFields(config({ modelType: "video", customModelConfig: groups })), 1);
    assert.equal(countCustomConfigFields(config({ modelType: "image", customModelConfig: groups })), 2);
});
