import assert from "node:assert/strict";
import { test } from "node:test";
import { creditAmount, creditText } from "./credit-amounts";

test("积分小数计算保持精确且只在结算时舍入", () => {
    assert.equal(creditText(creditAmount("0.1").plus("0.2").toFixed()), "0.3");
    assert.equal(creditText(creditAmount("0.123456").times(3).toFixed()), "0.370368");
    assert.equal(creditText("0.0000005"), "0.000001");
    assert.equal(creditText("999999999999999999.123456"), "999999999999999999.123456");
    assert.equal(creditText("15.000000"), "15");
});
