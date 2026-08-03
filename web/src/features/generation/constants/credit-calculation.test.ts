import assert from "node:assert/strict";
import test from "node:test";

import { isPositiveVideoSeconds, requestCreditCost } from "./credit-calculation.ts";

const modelCosts = [
    { model: "image-model", taskType: "image" as const, credits: 3, unit: "generation" as const },
    { model: "video-generation", taskType: "video" as const, credits: 4, unit: "generation" as const },
    { model: "video-second", taskType: "video" as const, credits: 5, unit: "second" as const },
];

test("按次模型按生成数量计费", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "video-generation", taskType: "video", count: 4, seconds: 8 }), 16);
});

test("按秒视频模型按时长和生成数量计费", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "video-second", taskType: "video", count: 4, seconds: 8 }), 160);
});

test("按秒模型的智能时长不产生可扣积分", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "video-second", taskType: "video", count: 1, seconds: -1 }), 0);
    assert.equal(isPositiveVideoSeconds("8"), true);
    assert.equal(isPositiveVideoSeconds("-1"), false);
});
