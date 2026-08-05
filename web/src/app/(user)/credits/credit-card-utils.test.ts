import assert from "node:assert/strict";
import test from "node:test";

const { creditCardBatchText, isCreditCardCode, maskCreditCardCode, normalizeCreditCardCode } = await import(new URL("./credit-card-utils.ts", import.meta.url).href);

test("卡密规范化会去除分隔符并转为大写", () => {
    assert.equal(normalizeCreditCardCode("abcd-efgh-jklm-npqr-stuv"), "ABCDEFGHJKLMNPQRSTUV");
    assert.equal(isCreditCardCode("ABCDEFGHJKLMNPQRSTUV"), true);
});

test("卡密脱敏只保留末四位", () => {
    assert.equal(maskCreditCardCode("ABCDEFGHJKLMNPQRSTUV"), "****-****-****-****-STUV");
});

test("批量卡密复制文本按一行一个输出", () => {
    assert.equal(creditCardBatchText(["abcd-efgh-jklm-npqr-stuv", "WXYZ-2345-6789-ABCD-EFGH"]), "ABCDEFGHJKLMNPQRSTUV\nWXYZ23456789ABCDEFGH");
});
