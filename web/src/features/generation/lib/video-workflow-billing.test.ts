import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, type AiConfig } from "@/features/settings/stores/use-config-store";

import { quoteVideoWorkflow } from "./video-workflow-billing";

function configFor(): AiConfig {
    return {
        ...defaultConfig,
        imageModel: "image-model",
        modelCosts: [
            { model: "image-model", taskType: "image" as const, credits: 5, unit: "generation" as const },
        ],
        videoModels: ["video-model"],
        videoModelBillingConfigurations: [
            {
                model: "video-model",
                capabilities: ["reference-to-video"],
                videoBillingConfiguration: {
                    billingUnit: "generation" as const,
                    minimumDurationSeconds: 3,
                    modePrices: { "reference-to-video": { "720p": 20 } },
                },
            },
        ],
    };
}

test("首尾帧工作流按两个图片阶段和视频阶段汇总报价", () => {
    const quote = quoteVideoWorkflow({
        config: configFor(),
        workflowType: "first-last-frame",
        model: "video-model",
        resolution: "720p",
        seconds: "5",
    });

    assert.equal(quote.available, true);
    if (quote.available) {
        assert.equal(quote.credits, 30);
        assert.deepEqual(quote.stages.map((stage) => [stage.role, stage.credits]), [
            ["first_frame", 5],
            ["last_frame", 5],
            ["video", 20],
        ]);
    }
});

test("首尾帧工作流优先使用模型原生首尾帧能力", () => {
    const config = configFor();
    config.videoModelBillingConfigurations = [{
        ...config.videoModelBillingConfigurations[0],
        capabilities: ["first-last-frame-to-video", "reference-to-video"],
        videoBillingConfiguration: {
            ...config.videoModelBillingConfigurations[0].videoBillingConfiguration,
            billingUnit: "generation" as const,
            minimumDurationSeconds: 3,
            modePrices: { "first-last-frame-to-video": { "720p": 13 }, "reference-to-video": { "720p": 20 } },
        },
    }];

    const quote = quoteVideoWorkflow({ config, workflowType: "first-last-frame", model: "video-model", resolution: "720p", seconds: 5 });

    assert.equal(quote.available, true);
    if (quote.available) {
        assert.equal(quote.credits, 23);
        assert.deepEqual(quote.requiredCapabilities, ["text-to-image", "first-last-frame-to-video"]);
        assert.equal(quote.stages.at(-1)?.credits, 13);
    }
});

test("首尾帧工作流在原生能力缺失时回退到参考图能力", () => {
    const quote = quoteVideoWorkflow({ config: configFor(), workflowType: "first-last-frame", model: "video-model", resolution: "720p", seconds: 5 });

    assert.equal(quote.available, true);
    if (quote.available) {
        assert.deepEqual(quote.requiredCapabilities, ["text-to-image", "reference-to-video"]);
        assert.equal(quote.stages.at(-1)?.credits, 20);
    }
});

test("原生首尾帧模式未配置768p价格时回退到已定价的参考图模式", () => {
    const config = configFor();
    config.videoModelBillingConfigurations = [{
        ...config.videoModelBillingConfigurations[0],
        capabilities: ["first-last-frame-to-video", "reference-to-video"],
        videoBillingConfiguration: {
            ...config.videoModelBillingConfigurations[0].videoBillingConfiguration,
            modePrices: {
                "first-last-frame-to-video": { "720p": 13 },
                "reference-to-video": { "768p": 21 },
            },
        },
    }];

    const quote = quoteVideoWorkflow({ config, workflowType: "first-last-frame", model: "video-model", resolution: "768p", seconds: 5 });

    assert.equal(quote.available, true);
    if (quote.available) {
        assert.deepEqual(quote.requiredCapabilities, ["text-to-image", "reference-to-video"]);
        assert.equal(quote.stages.at(-1)?.credits, 21);
    }
});

test("首尾帧工作流缺少两种视频能力时返回不可用原因", () => {
    const config = configFor();
    config.videoModelBillingConfigurations = [{
        ...config.videoModelBillingConfigurations[0],
        capabilities: [],
        videoBillingConfiguration: {
            ...config.videoModelBillingConfigurations[0].videoBillingConfiguration,
            billingUnit: "generation" as const,
            minimumDurationSeconds: 3,
            modePrices: {},
        },
    }];

    const quote = quoteVideoWorkflow({ config, workflowType: "first-last-frame", model: "video-model", resolution: "720p", seconds: 5 });

    assert.equal(quote.available, false);
    if (!quote.available) assert.match(quote.reason, /first-last-frame-to-video/);
});

test("首尾帧工作流未配置图片计费价格时不可报价", () => {
    const config = { ...configFor(), modelCosts: [] };
    assert.deepEqual(quoteVideoWorkflow({
        config,
        workflowType: "first-last-frame",
        model: "video-model",
        resolution: "720p",
        seconds: 5,
    }), { available: false, reason: "当前图片模型未配置图片生成计费价格" });
});

test("未注册视频工作流不可静默回退", () => {
    assert.deepEqual(quoteVideoWorkflow({
        config: configFor(),
        workflowType: "storyboard",
        model: "video-model",
        resolution: "720p",
        seconds: 5,
    }), { available: false, reason: "未注册视频工作流：storyboard" });
});
