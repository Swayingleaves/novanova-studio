import assert from "node:assert/strict";
import test from "node:test";

const { adminCreditFilterKey, adminCreditUserLabel } = await import(new URL("./admin-credit-utils.ts", import.meta.url).href);

test("管理员积分查询键随用户筛选变化", () => {
    assert.deepEqual(adminCreditFilterKey({ userId: 8, startDate: "2026-07-01", endDate: "2026-07-19", generationType: "image" }), [8, "2026-07-01", "2026-07-19", "image"]);
    assert.deepEqual(adminCreditFilterKey({ startDate: "2026-07-01", endDate: "2026-07-19" }), [null, "2026-07-01", "2026-07-19", null]);
});

test("管理员积分用户文案优先显示昵称", () => {
    assert.equal(adminCreditUserLabel({ nickname: "创作者", username: "creator", email: "creator@example.com" }), "创作者");
    assert.equal(adminCreditUserLabel({ nickname: null, username: "creator", email: "creator@example.com" }), "creator");
});
