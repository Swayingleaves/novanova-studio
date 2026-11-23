import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, type AiConfig, type VideoGenerationConstraints, type VideoGenerationMode } from "@/features/settings/stores/use-config-store";
import { VIDEO_ASPECT_RATIOS } from "./video-generation-constraints";
import { readVideoAudioOutput, videoAudioOn, videoAudioOutput, videoAudioParameter } from "./video-audio";

const constraints = (patch: Partial<VideoGenerationConstraints> = {}): VideoGenerationConstraints => ({
    minimumDurationSeconds: 2, maximumDurationSeconds: 10, minimumImageCount: 1, maximumImageCount: 2,
    supportedAspectRatios: [...VIDEO_ASPECT_RATIOS], maximumVideoCount: 2, maximumAudioCount: 4, ...patch,
});

/** 自定义模型：按模式配置生成音频约束，未给的模式不写该字段。 */
function customConfig(audio: Partial<Record<VideoGenerationMode, VideoGenerationConstraints["audioOutput"]>>): AiConfig {
    const modes: VideoGenerationMode[] = ["text-to-video", "image-to-video"];
    return { ...defaultConfig, model: "custom", videoModel: "custom", videoGenerationMode: "image-to-video", videoSeconds: "5", size: "16:9",
        videoModelBillingConfigurations: [{
            model: "custom", isCustomModel: true, capabilities: [...modes],
            videoBillingConfiguration: { billingUnit: "second", minimumDurationSeconds: 3, modePrices: Object.fromEntries(modes.map((mode) => [mode, { "720p": 1 }])) },
            videoGenerationConstraints: Object.fromEntries(modes.map((mode) => [mode, constraints({ audioOutput: audio[mode] ?? null })])) as Record<VideoGenerationMode, VideoGenerationConstraints>,
        }] };
}

test("自定义模型按当前模式的约束判断声音能力", () => {
    const config = customConfig({ "text-to-video": "switchable", "image-to-video": "none" });
    assert.equal(readVideoAudioOutput(config, "custom", "text-to-video"), "switchable");
    assert.equal(readVideoAudioOutput(config, "custom", "image-to-video"), "none");
    assert.equal(readVideoAudioOutput(config, "custom"), "none", "默认按页面当前模式");
    assert.equal(readVideoAudioOutput(customConfig({ "image-to-video": "always" }), "custom"), "always");
});

test("没填或填了不认识的值按模型默认，不写请求字段", () => {
    for (const value of [null, undefined, "dynamic" as unknown as "switchable"]) {
        const config = customConfig({ "image-to-video": value });
        assert.equal(readVideoAudioOutput(config, "custom"), "unknown");
        assert.equal(videoAudioOn(config, "custom"), undefined);
        assert.deepEqual(videoAudioParameter(config, "custom"), {});
    }
});

test("可开关时按页面设置给出本次开关与请求参数", () => {
    const base = customConfig({ "image-to-video": "switchable" });
    assert.equal(videoAudioOn(base, "custom"), true, "没设过按开启");
    assert.deepEqual(videoAudioParameter(base, "custom"), { generateAudio: true });
    const muted = { ...base, videoAudio: "false" };
    assert.equal(videoAudioOn(muted, "custom"), false);
    assert.deepEqual(videoAudioParameter(muted, "custom"), { generateAudio: false });
});

test("固定有声与不能出声不给请求字段，内置渠道仍按模型名判断", () => {
    assert.equal(videoAudioOn(customConfig({ "image-to-video": "always" }), "custom"), true);
    assert.deepEqual(videoAudioParameter(customConfig({ "image-to-video": "always" }), "custom"), {});
    assert.equal(videoAudioOn(customConfig({ "image-to-video": "none" }), "custom"), false);
    assert.deepEqual(videoAudioParameter(customConfig({ "image-to-video": "none" }), "custom"), {});

    // 内置渠道的判断仍只看渠道格式与模型名，不受自定义模型约束影响
    assert.equal(videoAudioOutput("seedance", "seedance-2.5"), "switchable");
    assert.equal(videoAudioOutput("seedance", "seedance-1.0-pro"), "none");
    assert.equal(videoAudioOutput("agnes", "agnes-video-2.5-flash"), "always");
});
