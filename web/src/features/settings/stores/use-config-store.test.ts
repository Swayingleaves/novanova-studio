import assert from "node:assert/strict";
import test from "node:test";
import type { ModelChannel } from "./use-config-store";
import { configFromModelConfigs, normalizeServerModelConfig, selectableModelsByCapability } from "./use-config-store";
import type { ServerModelConfig } from "@/services/api/server";

/** 构造模型配置，只声明与用例相关的字段。 */
function configuration(modelName: string, patch: Partial<ServerModelConfig> = {}): ServerModelConfig {
    return {
        id: `config-${modelName}`,
        channelId: "channel",
        modelName,
        modelType: "text",
        capabilities: [],
        defaultModel: false,
        enabled: true,
        sortOrder: 0,
        creditCost: 0,
        creditUnit: "generation",
        thinkingEnabled: true,
        reasoningEffort: "high",
        requestConcurrency: 1,
        convertImageSizeToPixels: false,
        imageSizeMappings: null,
        customBodyParameters: {},
        videoBillingConfiguration: null,
        imageBillingConfiguration: null,
        displayName: null,
        modelIcon: null,
        isCustomModel: false,
        customModelConfig: {},
        ...patch,
    };
}

const channels: ModelChannel[] = [{ id: "channel", name: "测试渠道", baseUrl: "https://example.com", apiKey: "", apiFormat: "openai", models: ["open-model", "closed-model"] }];

test("关闭的模型不进入可选项和默认模型，但仍保留在模型配置中供重新开启", () => {
    const config = configFromModelConfigs(channels, [configuration("closed-model", { enabled: false, defaultModel: true }), configuration("open-model", { defaultModel: true })]);

    assert.deepEqual(config.textModels, ["channel::open-model"]);
    assert.equal(config.textModel, "channel::open-model");
    // 关闭的模型仍要保留能力与价格，管理端才能继续编辑和重新开启。
    assert.deepEqual(config.modelCapabilities.map((item) => item.model).sort(), ["channel::closed-model", "channel::open-model"]);
});

test("响应缺少开启字段时按开启处理", () => {
    const legacy = { ...configuration("open-model") } as Partial<ServerModelConfig>;
    delete legacy.enabled;

    assert.equal(normalizeServerModelConfig(legacy as ServerModelConfig).enabled, true);
    assert.equal(normalizeServerModelConfig(configuration("closed-model", { enabled: false })).enabled, false);
});

test("不同渠道同名模型与同系列模型按展示名称自然聚合排序且保留默认模型", () => {
    const multiChannels: ModelChannel[] = [
        { id: "ch4", name: "官渠转4", baseUrl: "https://example.com", apiKey: "", apiFormat: "seedance", models: ["Seedance-2.5-flash", "Seedance-2.0"] },
        { id: "ch-wan", name: "wan赞助商渠道", baseUrl: "https://example.com", apiKey: "", apiFormat: "openai", models: ["Wan3.0-video"] },
        { id: "ch-mm", name: "minmax赞助商渠道", baseUrl: "https://example.com", apiKey: "", apiFormat: "minimax", models: ["MiniMax-H3"] },
        { id: "ch-hd", name: "低价高质渠道", baseUrl: "https://example.com", apiKey: "", apiFormat: "minimax", models: ["MiniMax-H3-HD"] },
        { id: "ch1", name: "官渠转1", baseUrl: "https://example.com", apiKey: "", apiFormat: "seedance", models: ["Seedance-2.0", "Seedance-2.5"] },
        { id: "ch3", name: "官渠转3", baseUrl: "https://example.com", apiKey: "", apiFormat: "seedance", models: ["Seedance-2.0-fast"] },
        { id: "ch2", name: "官渠转2", baseUrl: "https://example.com", apiKey: "", apiFormat: "seedance", models: ["Seedance-2.0-mini"] },
        { id: "ch-stable", name: "稳定渠道", baseUrl: "https://example.com", apiKey: "", apiFormat: "seedance", models: ["Seedance-1.5-pro", "alias-raw"] },
    ];
    const videoModels = [
        configuration("Seedance-2.5-flash", { id: "v1", channelId: "ch4", modelType: "video" }),
        configuration("Wan3.0-video", { id: "v2", channelId: "ch-wan", modelType: "video", defaultModel: true }),
        configuration("MiniMax-H3", { id: "v3", channelId: "ch-mm", modelType: "video" }),
        configuration("MiniMax-H3-HD", { id: "v4", channelId: "ch-hd", modelType: "video" }),
        configuration("Seedance-2.0", { id: "v5", channelId: "ch4", modelType: "video" }),
        configuration("Seedance-2.0", { id: "v6", channelId: "ch1", modelType: "video" }),
        configuration("Seedance-2.5", { id: "v7", channelId: "ch1", modelType: "video" }),
        configuration("Seedance-2.0-fast", { id: "v8", channelId: "ch3", modelType: "video" }),
        configuration("Seedance-2.0-mini", { id: "v9", channelId: "ch2", modelType: "video" }),
        configuration("Seedance-1.5-pro", { id: "v10", channelId: "ch-stable", modelType: "video" }),
        // displayName 应优先参与排序，把真实名为 alias-raw 的模型聚合到 MiniMax 系列旁边。
        configuration("alias-raw", { id: "v11", channelId: "ch-stable", modelType: "video", displayName: "MiniMax-H3-Alias" }),
    ];

    const config = configFromModelConfigs(multiChannels, videoModels);

    const expectedOrder = [
        "ch-mm::MiniMax-H3",
        "ch-stable::alias-raw",
        "ch-hd::MiniMax-H3-HD",
        "ch-stable::Seedance-1.5-pro",
        "ch1::Seedance-2.0",
        "ch4::Seedance-2.0",
        "ch3::Seedance-2.0-fast",
        "ch2::Seedance-2.0-mini",
        "ch1::Seedance-2.5",
        "ch4::Seedance-2.5-flash",
        "ch-wan::Wan3.0-video",
    ];
    assert.deepEqual(config.videoModels, expectedOrder);
    assert.deepEqual(selectableModelsByCapability(config, "video"), expectedOrder);
    assert.equal(config.videoModel, "ch-wan::Wan3.0-video");
});
