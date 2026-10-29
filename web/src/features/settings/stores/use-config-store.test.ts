import assert from "node:assert/strict";
import test from "node:test";
import type { ModelChannel } from "./use-config-store";
import { configFromModelConfigs, normalizeServerModelConfig } from "./use-config-store";
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
