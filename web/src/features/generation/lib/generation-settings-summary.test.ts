import assert from "node:assert/strict";
import test from "node:test";

import { formatImageGenerationSettingsSummary, formatVideoGenerationSettingsSummary, imageQualitySummaryLabel } from "./generation-settings-summary.ts";

test("图片摘要按画质、清晰度、比例、模型顺序组合", () => {
    assert.equal(formatImageGenerationSettingsSummary({ quality: "medium", resolution: "1K", ratio: "9:16", model: "gpt-image-2（gpt渠道1）" }), "标准|1K|9:16|gpt-image-2（gpt渠道1）");
});

test("视频摘要按清晰度、比例、时长、模型顺序组合", () => {
    assert.equal(formatVideoGenerationSettingsSummary({ resolution: "1080p", ratio: "16:9", duration: "5s", model: "seedance-1（seedance）" }), "1080p|16:9|5s|seedance-1（seedance）");
});

test("空值和包含分隔符的未知值不会制造额外分隔符", () => {
    assert.equal(formatImageGenerationSettingsSummary({ quality: "", resolution: "未知|清晰度", ratio: undefined, model: "" }), "未知/清晰度");
    assert.equal(formatVideoGenerationSettingsSummary({ resolution: null, ratio: "16:9", duration: "", model: undefined }), "16:9");
    assert.equal(imageQualitySummaryLabel("high"), "高");
    assert.equal(imageQualitySummaryLabel("自定义画质"), "自定义");
});
