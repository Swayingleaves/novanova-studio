import assert from "node:assert/strict";
import test from "node:test";

import { configFromModelConfigs, createModelChannel, normalizeServerModelConfig } from "@/features/settings/stores/use-config-store";
import { groupModelOptionsByChannel, resolveActiveChannelId } from "@/features/settings/lib/model-picker-groups";

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
