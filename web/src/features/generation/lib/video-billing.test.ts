import assert from "node:assert/strict";
import test from "node:test";

import { configFromModelConfigs, normalizeServerModelConfig, defaultConfig, type AiConfig } from "@/features/settings/stores/use-config-store";
import { availableVideoResolutions, quoteVideoGeneration, videoGenerationReferenceIssue, videoModelSupportsMode } from "./video-billing";

function configFor(billingUnit: "generation" | "second" = "generation"): AiConfig {
    return {
        ...defaultConfig,
        videoModels: ["video-model"],
        videoModelBillingConfigurations: [
            {
                model: "video-model",
                capabilities: ["text-to-video", "image-to-video", "reference-to-video"],
                videoBillingConfiguration: {
                    billingUnit,
                    minimumDurationSeconds: 3,
                    maximumDurationSeconds: null as number | null,
                    modePrices: {
                        "text-to-video": { auto: 6, "480p": 6, "720p": 14, "1080p": 22, "1088p": 24, "1440p": 30 },
                        "image-to-video": { auto: 6, "480p": 8, "720p": 16, "1080p": 25 },
                        "reference-to-video": { auto: 6, "720p": 20, "1080p": 32 },
                    },
                },
            },
        ],
    };
}

test("统一视频报价支持三种模式和Auto/具体分辨率", () => {
    const config = configFor();
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: "3" }), 14);
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "image-to-video", resolution: "480p", seconds: "4", imageReferenceCount: 1 }), 8);
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "reference-to-video", resolution: "1080p", seconds: "3", videoReferenceCount: 1 }), 32);
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "auto", seconds: "3" }), 6);
});

test("视频计费支持1088P和1440P分辨率", () => {
    const config = configFor();
    const resolutions = availableVideoResolutions(config, "video-model", "text-to-video");

    assert.ok(resolutions.includes("1088p"));
    assert.ok(resolutions.includes("1440p"));
    const quoteAt1088pResolution = quoteVideoGeneration({
        config,
        model: "video-model",
        mode: "text-to-video",
        resolution: "1088p",
        seconds: "3",
    });
    const quoteAt1440pResolution = quoteVideoGeneration({
        config,
        model: "video-model",
        mode: "text-to-video",
        resolution: "1440p",
        seconds: "3",
    });

    assertQuoteCredits(quoteAt1088pResolution, 24);
    assertQuoteCredits(quoteAt1440pResolution, 30);
});

test("按秒报价按时长和任务数量累计", () => {
    const quote = quoteVideoGeneration({ config: configFor("second"), model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 4, taskCount: 2 });
    assert.deepEqual(quote, { available: true, credits: "112", billingUnit: "second", unitPrice: 14, durationSeconds: 4, taskCount: 2 });
});

test("视频素材规则和最低时长失败时不可报价", () => {
    const config = configFor();
    assert.equal(videoGenerationReferenceIssue("text-to-video", 1, 0), "文生视频不能携带参考素材");
    assert.equal(videoGenerationReferenceIssue("image-to-video", 0, 1), "图生视频至少需要一张图片参考素材");
    assert.equal(videoGenerationReferenceIssue("image-to-video", 1, 1), "图生视频不能携带视频参考素材");
    assert.equal(videoGenerationReferenceIssue("reference-to-video", 0, 0), "全能参考至少需要一个参考素材");
    const shortQuote = quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 2 });
    assert.deepEqual(shortQuote, { available: false, reason: "视频时长不能小于 3 秒" });
});

test("未配置分辨率价格不显示零积分", () => {
    const quote = quoteVideoGeneration({ config: configFor(), model: "video-model", mode: "reference-to-video", resolution: "480p", seconds: 3, imageReferenceCount: 1 });
    assert.deepEqual(quote, { available: false, reason: "当前模式未配置所选分辨率价格" });
});

test("非法计费方式和无效价格均不可用于视频报价", () => {
    const invalidBillingConfig = configFor();
    const invalidBilling = invalidBillingConfig.videoModelBillingConfigurations[0]?.videoBillingConfiguration;
    assert.ok(invalidBilling);
    (invalidBilling as unknown as { billingUnit: string }).billingUnit = "invalid";
    assert.deepEqual(quoteVideoGeneration({ config: invalidBillingConfig, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 3 }), { available: false, reason: "当前模型视频计费方式配置无效" });

    const invalidPriceConfig = configFor();
    const prices = invalidPriceConfig.videoModelBillingConfigurations[0]?.videoBillingConfiguration?.modePrices?.["text-to-video"];
    assert.ok(prices);
    prices["720p"] = -1;
    assert.equal(
        videoModelSupportsMode(
            {
                ...invalidPriceConfig,
                videoModelBillingConfigurations: [
                    {
                        ...invalidPriceConfig.videoModelBillingConfigurations[0]!,
                        videoBillingConfiguration: {
                            ...invalidPriceConfig.videoModelBillingConfigurations[0]!.videoBillingConfiguration!,
                            modePrices: { "text-to-video": { "720p": -1 } },
                        },
                    },
                ],
            },
            "video-model",
            "text-to-video",
        ),
        false,
    );
    assert.equal(availableVideoResolutions(invalidPriceConfig, "video-model", "text-to-video").includes("720p"), false);
});

function assertQuoteCredits(quote: ReturnType<typeof quoteVideoGeneration>, credits: number) {
    assert.equal(quote.available, true);
    if (quote.available) assert.equal(quote.credits, String(credits));
}


test("音频输入能力不新增计费模式，切换能力或模式会阻止提交", () => {
    const config = configFor();
    config.modelCapabilities = [{ model: "video-model", capabilities: ["reference-to-video", "audio-input"] }];
    const input = { config, model: "video-model", mode: "reference-to-video" as const, resolution: "720p", seconds: 4, audioReferenceCount: 1 };
    assertQuoteCredits(quoteVideoGeneration(input), 20);
    assert.deepEqual(quoteVideoGeneration({ ...input, mode: "text-to-video" }), { available: false, reason: "音频输入仅支持全能参考模式" });
    config.modelCapabilities[0].capabilities = ["reference-to-video"];
    assert.deepEqual(quoteVideoGeneration(input), { available: false, reason: "当前模型未开启音频输入能力" });
    assert.equal(input.audioReferenceCount, 1);
});


test("服务端音频能力下发到画布配置时保留能力，价格维度不变", () => {
    const serverConfig = normalizeServerModelConfig({
        id: "model-config", channelId: "channel", modelName: "MiniMax-H3", modelType: "video", capabilities: ["reference-to-video", "audio-input"], defaultModel: true, enabled: true,
        sortOrder: 0, creditCost: 0, creditUnit: "generation", thinkingEnabled: false, reasoningEffort: "high", requestConcurrency: 1, convertImageSizeToPixels: false, imageSizeMappings: null,
        customBodyParameters: {}, videoBillingConfiguration: { billingUnit: "generation", minimumDurationSeconds: 3, modePrices: { "reference-to-video": { "720p": 20 } } }, imageBillingConfiguration: null, displayName: null, modelIcon: null, isCustomModel: false, customModelConfig: {},
    });
    const config = configFromModelConfigs([{ id: "channel", name: "测试", baseUrl: "https://example.com", apiKey: "", apiFormat: "minimax", models: ["MiniMax-H3"] }], [serverConfig]);
    assert.deepEqual(config.modelCapabilities, [{ model: "channel::MiniMax-H3", capabilities: ["reference-to-video", "audio-input"] }]);
    assert.deepEqual(Object.keys(config.videoModelBillingConfigurations[0].videoBillingConfiguration!.modePrices), ["reference-to-video"]);
    serverConfig.capabilities = ["reference-to-video"];
    assert.equal(configFromModelConfigs(config.channels, [serverConfig]).modelCapabilities[0].capabilities.includes("audio-input"), false);
});

test("配置最长时间后超出上限不可报价，默认15秒、-1不限制、非法上限直接拦截", () => {
    const config = configFor("second");
    // 未填（null）时默认上限为 15 秒
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 15 }), 210);
    assert.deepEqual(
        quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 16 }),
        { available: false, reason: "视频时长不能超过 15 秒" },
    );
    // 设置为 -1 表示不限制
    config.videoModelBillingConfigurations[0].videoBillingConfiguration!.maximumDurationSeconds = -1;
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 30 }), 420);
    // 设置为具体正整数
    config.videoModelBillingConfigurations[0].videoBillingConfiguration!.maximumDurationSeconds = 10;
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 10 }), 140);
    assert.deepEqual(
        quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 11 }),
        { available: false, reason: "视频时长不能超过 10 秒" },
    );
    // 0 或小于最短时间均视为非法
    config.videoModelBillingConfigurations[0].videoBillingConfiguration!.maximumDurationSeconds = 0;
    assert.deepEqual(
        quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 3 }),
        { available: false, reason: "当前模型最长时间配置无效" },
    );
    config.videoModelBillingConfigurations[0].videoBillingConfiguration!.maximumDurationSeconds = 2;
    assert.deepEqual(
        quoteVideoGeneration({ config, model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 3 }),
        { available: false, reason: "当前模型最长时间配置无效" },
    );
});

test("全能参考按是否有视频输入自动选择对应分辨率价格，未单独配置时沿用无视频输入价格", () => {
    const config = configFor("generation");
    config.videoModelBillingConfigurations[0].videoBillingConfiguration!.referenceVideoInputPrices = {
        "720p": 35,
        "4k": 90,
    };

    // 720p：无视频输入用 20，有视频输入用 35
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "reference-to-video", resolution: "720p", seconds: 5, imageReferenceCount: 1, videoReferenceCount: 0 }), 20);
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "reference-to-video", resolution: "720p", seconds: 5, videoReferenceCount: 1 }), 35);

    // 1080p：未配置有视频输入独立价格，有视频输入时沿用无视频输入价格 32
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "reference-to-video", resolution: "1080p", seconds: 5, videoReferenceCount: 1 }), 32);

    // 4k：仅配置有视频输入价格，无视频输入时提示未配置，有视频输入时按 90 计费
    assert.equal(availableVideoResolutions(config, "video-model", "reference-to-video").includes("4k"), true);
    assert.deepEqual(
        quoteVideoGeneration({ config, model: "video-model", mode: "reference-to-video", resolution: "4k", seconds: 5, imageReferenceCount: 1, videoReferenceCount: 0 }),
        { available: false, reason: "当前模式未配置所选分辨率价格" },
    );
    assertQuoteCredits(quoteVideoGeneration({ config, model: "video-model", mode: "reference-to-video", resolution: "4k", seconds: 5, videoReferenceCount: 1 }), 90);

    // 仅配置有视频输入价格时也应视为支持全能参考模式
    const onlyVideoInputConfig = configFor("generation");
    onlyVideoInputConfig.videoModelBillingConfigurations[0].videoBillingConfiguration!.modePrices["reference-to-video"] = {};
    onlyVideoInputConfig.videoModelBillingConfigurations[0].videoBillingConfiguration!.referenceVideoInputPrices = { "720p": 45 };
    assert.equal(videoModelSupportsMode(onlyVideoInputConfig, "video-model", "reference-to-video"), true);
});
