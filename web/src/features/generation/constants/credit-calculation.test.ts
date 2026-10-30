import assert from "node:assert/strict";
import test from "node:test";

import { requestCreditCost } from "./credit-calculation.ts";

const modelCosts = [
    { model: "image-model", taskType: "image" as const, credits: 3, unit: "generation" as const },
    { model: "text-model", taskType: "text" as const, credits: 4, unit: "generation" as const },
    { model: "priced-image-model", taskType: "image" as const, credits: 3, unit: "generation" as const, resolutionPrices: { "1K": 1, "2K": 4, "4K": 9 } },
];

test("图片模型按生成数量计费", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "image-model", taskType: "image", count: 4 }), "12");
});

test("配置分辨率价目表的图片模型按所选清晰度取价", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "priced-image-model", taskType: "image", count: 2, resolution: "2K" }), "8");
    assert.equal(requestCreditCost({ modelCosts, model: "priced-image-model", taskType: "image", count: 1, resolution: "4k" }), "9");
});

test("未配置的清晰度回退到模型单价", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "priced-image-model", taskType: "image", count: 1, resolution: "8K" }), "3");
    assert.equal(requestCreditCost({ modelCosts, model: "priced-image-model", taskType: "image", count: 1 }), "3");
    assert.equal(requestCreditCost({ modelCosts, model: "image-model", taskType: "image", count: 1, resolution: "2K" }), "3");
});

test("空字符串档位价格按未配置处理，不会让 Decimal 报错", () => {
    const blankCosts = [{ model: "blank-image-model", taskType: "image" as const, credits: 3, unit: "generation" as const, resolutionPrices: { "2K": "" } }];
    assert.equal(requestCreditCost({ modelCosts: blankCosts, model: "blank-image-model", taskType: "image", count: 1, resolution: "2K" }), "3");
});

test("配置分辨率价目表的图片模型按所选清晰度取价", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "priced-image-model", taskType: "image", count: 2, resolution: "2K" }), 8);
    assert.equal(requestCreditCost({ modelCosts, model: "priced-image-model", taskType: "image", count: 1, resolution: "4k" }), 9);
});

test("未配置的清晰度回退到模型单价", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "priced-image-model", taskType: "image", count: 1, resolution: "8K" }), 3);
    assert.equal(requestCreditCost({ modelCosts, model: "priced-image-model", taskType: "image", count: 1 }), 3);
    assert.equal(requestCreditCost({ modelCosts, model: "image-model", taskType: "image", count: 1, resolution: "2K" }), 3);
});

test("档位价格非数字时回退到模型单价", () => {
    // 服务端只会下发整数价格，这里防御脏数据导致展示价异常。
    const dirtyCosts = [{ model: "dirty-image-model", taskType: "image" as const, credits: 3, unit: "generation" as const, resolutionPrices: { "2K": Number.NaN } }];
    assert.equal(requestCreditCost({ modelCosts: dirtyCosts, model: "dirty-image-model", taskType: "image", count: 1, resolution: "2K" }), 3);
});

test("文本模型不计积分", () => {
    assert.equal(requestCreditCost({ modelCosts, model: "text-model", taskType: "text", count: 4 }), 0);
});
