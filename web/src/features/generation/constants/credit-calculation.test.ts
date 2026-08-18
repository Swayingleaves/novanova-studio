import assert from "node:assert/strict";
import test from "node:test";

import { requestCreditCost } from "./credit-calculation.ts";

const modelCosts = [
    { model: "image-model", taskType: "image" as const, credits: 3, unit: "generation" as const },
    { model: "text-model", taskType: "text" as const, credits: 4, unit: "generation" as const },
];

test("图片模型按生成数量计费", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "image-model", taskType: "image", count: 4 }), 12);
});

test("文本模型不计积分", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "text-model", taskType: "text", count: 4 }), 0);
});
