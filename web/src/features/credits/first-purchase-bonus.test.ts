import assert from "node:assert/strict";
import test from "node:test";
import { CREDITS_PER_YUAN, firstPurchaseBonusCredits, firstPurchaseBonusYuan, firstPurchaseEffectiveBonus, firstPurchaseTotalCredits, isExactBonusYuan } from "./first-purchase-bonus";

test("首充赠送按支付金额折算积分后乘以比例", () => {
    assert.equal(CREDITS_PER_YUAN, 10);
    assert.equal(firstPurchaseBonusCredits("20", "50").toString(), "100");
    assert.equal(firstPurchaseBonusCredits("20", "100").toString(), "200");
    assert.equal(firstPurchaseBonusCredits("20", "0").toString(), "0");
    assert.equal(firstPurchaseBonusCredits("9.9", "50").toString(), "49.5");
});

test("比例大于零时六位小数向下取整，不受全局半入影响", () => {
    assert.equal(firstPurchaseBonusCredits("19.99", "50").toString(), "99.95");
    assert.equal(firstPurchaseBonusCredits("1", "33.33").toString(), "3.333");
    assert.equal(firstPurchaseBonusCredits("3.333", "50").toString(), "16.665");
    assert.equal(firstPurchaseBonusCredits("0.01", "33.33").toString(), "0.03333");
});

test("展示金额按积分折算并向下取整到分", () => {
    assert.equal(firstPurchaseBonusYuan("100").toString(), "10");
    assert.equal(firstPurchaseBonusYuan("99.95").toString(), "9.99");
    assert.equal(firstPurchaseBonusYuan("0.03333").toString(), "0");
});

test("展示金额与积分的对应关系决定是否需要约等文案", () => {
    assert.equal(isExactBonusYuan("10", "100"), true);
    assert.equal(isExactBonusYuan("9.99", "99.95"), false);
});

test("商品自带赠送与首充赠送取较大者，不叠加", () => {
    assert.equal(firstPurchaseEffectiveBonus("0", "20", "50").toString(), "100");
    assert.equal(firstPurchaseEffectiveBonus("50", "20", "50").toString(), "100");
    assert.equal(firstPurchaseEffectiveBonus("150", "20", "50").toString(), "150");
    assert.equal(firstPurchaseEffectiveBonus("0", "20", "0").toString(), "0");
});

test("到账总积分等于基础积分加较大者赠送", () => {
    assert.equal(firstPurchaseTotalCredits("200", "0", "20", "50").toString(), "300");
    assert.equal(firstPurchaseTotalCredits("200", "50", "20", "50").toString(), "300");
    assert.equal(firstPurchaseTotalCredits("100", "50", "10", "50").toString(), "150");
    assert.equal(firstPurchaseTotalCredits("100", "80", "10", "50").toString(), "180");
    assert.equal(firstPurchaseTotalCredits("200", "0", "20", "0").toString(), "200");
});
