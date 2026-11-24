import assert from "node:assert/strict";
import test from "node:test";

import { configFromModelConfigs, createModelChannel, normalizeServerModelConfig } from "@/features/settings/stores/use-config-store";
import { groupModelOptionsByChannel, resolveActiveChannelId, resolveModelOptionPrice, resolveModelOptionSpecs, resolveModelSuccessRateTone } from "@/features/settings/lib/model-picker-groups";

test("模型选项按渠道分组并保持渠道和模型原有顺序", () => {
    const channels = [
        createModelChannel({ id: "ch-a", name: "NANA-API", apiFormat: "nana", models: ["seedance-2.0-fast", "wan3.0-video"] }),
        createModelChannel({ id: "ch-b", name: "官方直连", apiFormat: "openai", models: ["sora-2"] }),
    ];
    const groups = groupModelOptionsByChannel(
        ["ch-a::seedance-2.0-fast", "ch-b::sora-2", "ch-a::wan3.0-video", "local-model"],
        { channels },
        "默认渠道",
    );

    assert.deepEqual(groups, [
        { channelId: "ch-a", channelName: "NANA-API", models: ["ch-a::seedance-2.0-fast", "ch-a::wan3.0-video"] },
        { channelId: "ch-b", channelName: "官方直连", models: ["ch-b::sora-2"] },
        { channelId: "__default__", channelName: "默认渠道", models: ["local-model"] },
    ]);

    assert.equal(resolveActiveChannelId(groups, "ch-b::sora-2"), "ch-b");
    assert.equal(resolveActiveChannelId(groups, "ch-b::sora-2", "ch-a"), "ch-a");
    assert.equal(resolveActiveChannelId(groups, ""), "ch-a");
});

test("模型配置转换时保留模型说明字段并过滤空白说明", () => {
    const channels = [createModelChannel({ id: "ch-a", name: "NANA-API", apiFormat: "nana", models: ["gpt-image", "flux-pro"] })];
    const configs = [
        normalizeServerModelConfig({
            id: "m1", channelId: "ch-a", modelName: "gpt-image", modelType: "image", capabilities: ["text-to-image"],
            defaultModel: true, enabled: true, sortOrder: 0, creditCost: "1", creditUnit: "generation",
            thinkingEnabled: false, reasoningEffort: "high", requestConcurrency: 1, convertImageSizeToPixels: false,
            imageSizeMappings: null, customBodyParameters: {}, videoBillingConfiguration: null, imageBillingConfiguration: null,
            displayName: "GPT 图像", modelIcon: null, description: "  适合精细海报生成  ", isCustomModel: false, customModelConfig: {},
        }),
        normalizeServerModelConfig({
            id: "m2", channelId: "ch-a", modelName: "flux-pro", modelType: "image", capabilities: ["text-to-image"],
            defaultModel: false, enabled: true, sortOrder: 1, creditCost: "1", creditUnit: "generation",
            thinkingEnabled: false, reasoningEffort: "high", requestConcurrency: 1, convertImageSizeToPixels: false,
            imageSizeMappings: null, customBodyParameters: {}, videoBillingConfiguration: null, imageBillingConfiguration: null,
            displayName: null, modelIcon: null, description: "   ", isCustomModel: false, customModelConfig: {},
        }),
    ];

    const aiConfig = configFromModelConfigs(channels, configs);
    assert.deepEqual(aiConfig.modelDescriptions, { "ch-a::gpt-image": "适合精细海报生成" });
});

test("模型成功率区间正确映射红黄绿三色指示灯并透传配置统计", () => {
    assert.equal(resolveModelSuccessRateTone(100), "green");
    assert.equal(resolveModelSuccessRateTone(80), "green");
    assert.equal(resolveModelSuccessRateTone(79), "yellow");
    assert.equal(resolveModelSuccessRateTone(50), "yellow");
    assert.equal(resolveModelSuccessRateTone(49), "red");
    assert.equal(resolveModelSuccessRateTone(0), "red");

    const channels = [createModelChannel({ id: "ch-a", name: "NANA-API", apiFormat: "nana", models: ["gpt-image", "flux-pro"] })];
    const configs = [
        normalizeServerModelConfig({
            id: "m1", channelId: "ch-a", modelName: "gpt-image", modelType: "image", capabilities: ["text-to-image"],
            defaultModel: true, enabled: true, sortOrder: 0, creditCost: "1", creditUnit: "generation",
            thinkingEnabled: false, reasoningEffort: "high", requestConcurrency: 1, convertImageSizeToPixels: false,
            imageSizeMappings: null, customBodyParameters: {}, videoBillingConfiguration: null, imageBillingConfiguration: null,
            displayName: "GPT 图像", modelIcon: null, description: null, isCustomModel: false, customModelConfig: {},
            successRateStats: { successRate: 92, succeededCount: 46, totalCount: 50, windowDays: 3 },
        }),
        normalizeServerModelConfig({
            id: "m2", channelId: "ch-a", modelName: "flux-pro", modelType: "image", capabilities: ["text-to-image"],
            defaultModel: false, enabled: true, sortOrder: 1, creditCost: "1", creditUnit: "generation",
            thinkingEnabled: false, reasoningEffort: "high", requestConcurrency: 1, convertImageSizeToPixels: false,
            imageSizeMappings: null, customBodyParameters: {}, videoBillingConfiguration: null, imageBillingConfiguration: null,
            displayName: null, modelIcon: null, description: null, isCustomModel: false, customModelConfig: {},
            successRateStats: { successRate: 0, succeededCount: 0, totalCount: 0, windowDays: 3 },
        }),
    ];

    const aiConfig = configFromModelConfigs(channels, configs);
    assert.deepEqual(aiConfig.modelSuccessRateStats, {
        "ch-a::gpt-image": { successRate: 92, succeededCount: 46, totalCount: 50, windowDays: 3 },
    });
});

test("模型选择器正确解析图片/视频/文本模型单价与分档区间价格", () => {
    const config = {
        modelCosts: [
            { model: "ch-a::img-basic", taskType: "image" as const, credits: "5", unit: "generation" as const },
            { model: "ch-a::img-tiered", taskType: "image" as const, credits: "5", unit: "generation" as const, resolutionPrices: { "1K": "2", "2K": "5", "4K": "10" } },
            { model: "ch-a::vid-sec", taskType: "video" as const, credits: "10", unit: "second" as const },
            { model: "ch-a::text-free", taskType: "text" as const, credits: "0", unit: "generation" as const },
        ],
        videoModelBillingConfigurations: [
            {
                model: "ch-a::vid-sec",
                capabilities: ["text-to-video"],
                videoBillingConfiguration: {
                    billingUnit: "second" as const,
                    minimumDurationSeconds: 5,
                    modePrices: {
                        "text-to-video": { "720p": "8", "1080p": "12" },
                    },
                },
            },
        ],
    };

    assert.equal(resolveModelOptionPrice(config, "ch-a::img-basic", "image")?.label, "5/次");
    assert.equal(resolveModelOptionPrice(config, "ch-a::img-tiered", "image")?.label, "2~10/次");
    assert.equal(resolveModelOptionPrice(config, "ch-a::vid-sec", "video")?.label, "8~12/秒");
    assert.equal(resolveModelOptionPrice(config, "ch-a::text-free", "text")?.label, "免费");
    assert.equal(resolveModelOptionPrice(config, "ch-a::text-free", "text")?.isFree, true);
});

test("模型选择器正确解析视频模型的最大时长和图片/视频/音频输入上限", () => {
    const config = {
        videoModelBillingConfigurations: [
            {
                model: "ch-a::seedance-2.5",
                capabilities: ["text-to-video", "image-to-video", "reference-to-video", "audio-input"],
                isCustomModel: true,
                videoBillingConfiguration: {
                    billingUnit: "second" as const,
                    minimumDurationSeconds: 4,
                    maximumDurationSeconds: 30,
                    modePrices: {},
                },
                videoGenerationConstraints: {
                    "text-to-video": { maximumDurationSeconds: 30, maximumImageCount: 0 },
                    "reference-to-video": { maximumDurationSeconds: 30, maximumImageCount: 30, maximumVideoCount: 10, maximumAudioCount: 10 },
                },
            },
            {
                model: "ch-a::seedance-builtin",
                capabilities: ["text-to-video", "reference-to-video", "audio-input"],
                isCustomModel: false,
                videoBillingConfiguration: {
                    billingUnit: "second" as const,
                    minimumDurationSeconds: 4,
                    maximumDurationSeconds: 15,
                    modePrices: {},
                },
            },
            {
                model: "ch-a::i2v-only",
                capabilities: ["image-to-video"],
                isCustomModel: false,
                videoBillingConfiguration: {
                    billingUnit: "generation" as const,
                    minimumDurationSeconds: 5,
                    maximumDurationSeconds: -1,
                    modePrices: {},
                },
            },
        ],
    };

    assert.deepEqual(resolveModelOptionSpecs(config, "ch-a::seedance-2.5", "video"), {
        maxDurationLabel: "最长 30s",
        maxImageCount: 30,
        maxVideoCount: 10,
        maxAudioCount: 10,
    });
    assert.deepEqual(resolveModelOptionSpecs(config, "ch-a::seedance-builtin", "video"), {
        maxDurationLabel: "最长 15s",
        maxImageCount: 9,
        maxVideoCount: 3,
        maxAudioCount: 3,
    });
    assert.deepEqual(resolveModelOptionSpecs(config, "ch-a::i2v-only", "video"), {
        maxDurationLabel: "时长不限",
        maxImageCount: 1,
        maxVideoCount: 0,
        maxAudioCount: 0,
    });
    assert.equal(resolveModelOptionSpecs(config, "ch-a::seedance-2.5", "image"), null);
});
