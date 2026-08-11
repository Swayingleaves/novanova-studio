import assert from "node:assert/strict";
import test from "node:test";

const { generationSourceLabel, normalizeGenerationDistribution, normalizeModelDistribution } = await import(new URL("./credit-page-utils.ts", import.meta.url).href);

test("任务类型分布固定显示图片和视频的有效消耗", () => {
    assert.deepEqual(normalizeGenerationDistribution([
        { name: "video", consumedCredits: 18 },
        { name: "image", consumedCredits: 6 },
    ]), [
        { name: "图片生成", value: 6 },
        { name: "视频生成", value: 18 },
    ]);
});

test("模型分布忽略零消耗项", () => {
    assert.deepEqual(normalizeModelDistribution([
        { name: "模型一", consumedCredits: 0 },
        { name: "模型二", consumedCredits: 12 },
    ]), [{ name: "模型二", value: 12 }]);
});

test("历史流水缺少来源时明确显示未记录", () => {
    assert.equal(generationSourceLabel(null), "未记录");
    assert.equal(generationSourceLabel("canvas"), "无限画布");
});

test("分镜任务来源显示为分镜脚本", () => {
    assert.equal(generationSourceLabel("storyboard"), "分镜脚本");
});
