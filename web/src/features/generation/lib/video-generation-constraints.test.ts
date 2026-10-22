import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, type AiConfig, type VideoGenerationConstraints, type VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import { VIDEO_ASPECT_RATIOS, readVideoGenerationConstraintIssue, videoConstraintConfigurationIssues } from "./video-generation-constraints";
import { quoteVideoGeneration } from "./video-billing";
import { quoteVideoWorkflow } from "./video-workflow-billing";
import { readVideoDurationRange } from "./video-duration";

const constraints = (patch: Partial<VideoGenerationConstraints> = {}): VideoGenerationConstraints => ({
    minimumDurationSeconds: 2, maximumDurationSeconds: 10, minimumImageCount: 1, maximumImageCount: 2,
    supportedAspectRatios: [...VIDEO_ASPECT_RATIOS], maximumVideoCount: 2, maximumAudioCount: 4, ...patch,
});

function customConfig(): AiConfig {
    const modes: VideoGenerationMode[] = ["text-to-video", "image-to-video", "reference-to-video", "first-last-frame-to-video"];
    return { ...defaultConfig, model: "custom", videoModel: "custom", size: "16:9", videoSeconds: "5", videoGenerationMode: "image-to-video",
        modelCapabilities: [{ model: "custom", capabilities: [...modes, "audio-input"] }],
        videoModelBillingConfigurations: [{ model: "custom", isCustomModel: true, capabilities: [...modes, "audio-input"],
            videoBillingConfiguration: { billingUnit: "second", minimumDurationSeconds: 3,
                modePrices: Object.fromEntries(modes.map((mode) => [mode, { "720p": 1 }])) },
            videoGenerationConstraints: {
                "text-to-video": constraints({ minimumImageCount: 0, maximumImageCount: 0 }),
                "image-to-video": constraints(),
                "reference-to-video": constraints({ minimumImageCount: 0 }),
                "first-last-frame-to-video": constraints({ minimumImageCount: 2, maximumImageCount: 2 }),
            } }] };
}

test("四种模式配置完整、缺失、非法整数及空比例集合", () => {
    const config = customConfig();
    const groups = config.videoModelBillingConfigurations[0].videoGenerationConstraints!;
    for (const mode of Object.keys(groups) as VideoGenerationMode[]) assert.deepEqual(videoConstraintConfigurationIssues(mode, groups[mode], true, 3), []);
    assert.ok(videoConstraintConfigurationIssues("image-to-video", undefined, false).length);
    for (const value of [null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.ok(videoConstraintConfigurationIssues("image-to-video", constraints({ minimumImageCount: value }), false).length);
    }
    for (const patch of [{ maximumDurationSeconds: 1 }, { minimumImageCount: 3 }, { supportedAspectRatios: [] }, { supportedAspectRatios: ["2:1"] }]) {
        assert.ok(videoConstraintConfigurationIssues("image-to-video", constraints(patch), false, 3).length);
    }
    assert.ok(videoConstraintConfigurationIssues("text-to-video", constraints(), false).length);
    assert.ok(videoConstraintConfigurationIssues("first-last-frame-to-video", constraints(), false).length);
});

test("全能参考与音频开关联动且必须允许一种素材", () => {
    assert.deepEqual(videoConstraintConfigurationIssues("reference-to-video", constraints({ minimumImageCount: 0 }), true), []);
    assert.ok(videoConstraintConfigurationIssues("reference-to-video", constraints({ maximumAudioCount: 0 }), true).length);
    assert.ok(videoConstraintConfigurationIssues("reference-to-video", constraints(), false).length);
    assert.ok(videoConstraintConfigurationIssues("reference-to-video", constraints({ minimumImageCount: 0, maximumImageCount: 0, maximumVideoCount: 0, maximumAudioCount: 0 }), false).length);
});

test("七种比例逐一允许，像素尺寸和未配置比例拒绝", () => {
    for (const ratio of VIDEO_ASPECT_RATIOS) {
        const config = customConfig();
        config.videoModelBillingConfigurations[0].videoGenerationConstraints!["image-to-video"]!.supportedAspectRatios = [ratio];
        assert.equal(readVideoGenerationConstraintIssue({ config, size: ratio, imageCount: 1 }), "");
        assert.match(readVideoGenerationConstraintIssue({ config, size: "1280x720", imageCount: 1 }), /比例.*1280x720/);
    }
});

test("时长取计费与模式交集，图片数量检查上下边界", () => {
    const config = customConfig();
    assert.deepEqual(readVideoDurationRange(config), { min: 3, max: 10 });
    for (const seconds of [3, 10]) for (const imageCount of [1, 2]) assert.equal(readVideoGenerationConstraintIssue({ config, seconds, imageCount }), "");
    for (const seconds of [2, 11, 3.5]) assert.match(readVideoGenerationConstraintIssue({ config, seconds, imageCount: 1 }), /3.*10/);
    for (const imageCount of [0, 3]) assert.match(readVideoGenerationConstraintIssue({ config, imageCount }), /1.*2/);
    assert.equal(readVideoGenerationConstraintIssue({ config, imageCount: 0, addingReferences: true }), "");
    assert.match(readVideoGenerationConstraintIssue({ config, imageCount: 3, addingReferences: true }), /3/);
    assert.ok(videoConstraintConfigurationIssues("image-to-video", constraints({ maximumDurationSeconds: 2 }), true, 3).length);
});

test("全能参考上限以配置为准，允许超过原固定音频数量且校验超量", () => {
    const config = customConfig();
    const mode = "reference-to-video";
    assert.equal(readVideoGenerationConstraintIssue({ config, mode, videoCount: 2, audioCount: 4 }), "");
    assert.match(readVideoGenerationConstraintIssue({ config, mode, videoCount: 3 }), /2.*3/);
    assert.match(readVideoGenerationConstraintIssue({ config, mode, audioCount: 5 }), /4.*5/);
    assert.match(readVideoGenerationConstraintIssue({ config, mode }), /至少.*素材/);
    const quote = quoteVideoGeneration({ config, model: "custom", mode, resolution: "720p", seconds: 5, audioReferenceCount: 4 });
    assert.equal(quote.available, true);
});

test("切换模式只报告非法输入，校验和报价均不修改已有参数", () => {
    const config = customConfig();
    const before = structuredClone(config);
    assert.match(readVideoGenerationConstraintIssue({ config, mode: "text-to-video", imageCount: 1 }), /0.*1/);
    config.videoModelBillingConfigurations[0].videoGenerationConstraints!["image-to-video"] = undefined;
    const missing = readVideoGenerationConstraintIssue({ config, imageCount: 1 });
    assert.match(missing, /配置.*补全|配置.*不完整/);
    config.videoModelBillingConfigurations[0].videoGenerationConstraints!["image-to-video"] = before.videoModelBillingConfigurations[0].videoGenerationConstraints!["image-to-video"];
    assert.deepEqual(config, before);
});

test("工作流报价按预计生成的两张图片提前检查", () => {
    const config = customConfig();
    config.imageModel = "image";
    config.modelCosts = [{ model: "image", taskType: "image", credits: 1, unit: "generation" }];
    const billing = config.videoModelBillingConfigurations[0];
    billing.capabilities = ["reference-to-video", "audio-input"];
    billing.videoGenerationConstraints!["reference-to-video"]!.maximumImageCount = 1;
    const quote = quoteVideoWorkflow({ config, workflowType: "first-last-frame", model: "custom", resolution: "720p", seconds: 5 });
    assert.equal(quote.available, false);
    if (!quote.available) assert.match(quote.reason, /0–1 张图片.*2/);
});
