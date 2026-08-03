import assert from "node:assert/strict";
import test from "node:test";

import { createModelChannel, defaultBaseUrlForApiFormat } from "../../settings/stores/use-config-store.ts";
import {
    isMiniMaxH3VideoConfig,
    miniMaxH3ResolutionOptions,
    normalizeMiniMaxH3Duration,
    normalizeMiniMaxH3Ratio,
    normalizeMiniMaxH3VideoSettings,
} from "./minimax-h3-video.ts";

test("MiniMax 渠道应使用默认地址并保留手工模型配置", () => {
    assert.equal(defaultBaseUrlForApiFormat("minimax"), "https://api.minimaxi.com");
    const channel = createModelChannel({ apiFormat: "minimax", models: ["MiniMax-H3"] });
    assert.match(channel.id, /.+/);
    assert.equal(channel.baseUrl, "https://api.minimaxi.com");
    assert.equal(channel.apiFormat, "minimax");
    assert.deepEqual(channel.models, ["MiniMax-H3"]);
});

test("MiniMax H3 配置只匹配 minimax 渠道中的 MiniMax-H3 模型", () => {
    assert.equal(isMiniMaxH3VideoConfig({ apiFormat: "minimax", model: "MiniMax-H3", videoModel: "", baseUrl: "" }), true);
    assert.equal(isMiniMaxH3VideoConfig({ apiFormat: "minimax", model: "MiniMax-H2", videoModel: "", baseUrl: "" }), false);
    assert.equal(isMiniMaxH3VideoConfig({ apiFormat: "openai", model: "MiniMax-H3", videoModel: "", baseUrl: "" }), false);
});

test("MiniMax H3 设置应把旧默认值规范为受支持的参数", () => {
    assert.deepEqual(miniMaxH3ResolutionOptions, ["768p", "2k"]);
    assert.deepEqual(normalizeMiniMaxH3VideoSettings("720p", "auto", "3"), {
        vquality: "768p",
        size: "16:9",
        videoSeconds: "4",
    });
    assert.equal(normalizeMiniMaxH3Ratio("1280x720"), "16:9");
    assert.equal(normalizeMiniMaxH3Ratio("adaptive"), "adaptive");
    assert.equal(normalizeMiniMaxH3Duration("18"), 15);
});
