import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig } from "@/features/settings/stores/use-config-store";
import { availableVideoResolutions, quoteVideoGeneration, videoGenerationReferenceIssue, videoModelSupportsMode } from "./video-billing";

function configFor(billingUnit: "generation" | "second" = "generation") {
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
                    modePrices: {
                        "text-to-video": { auto: 6, "480p": 6, "720p": 14, "1080p": 22 },
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

test("按秒报价按时长和任务数量累计", () => {
    const quote = quoteVideoGeneration({ config: configFor("second"), model: "video-model", mode: "text-to-video", resolution: "720p", seconds: 4, taskCount: 2 });
    assert.deepEqual(quote, { available: true, credits: 112, billingUnit: "second", unitPrice: 14, durationSeconds: 4, taskCount: 2 });
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
    if (quote.available) assert.equal(quote.credits, credits);
}
