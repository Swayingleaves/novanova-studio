import assert from "node:assert/strict";
import test from "node:test";
import { hasInsufficientCredits, isInsufficientCreditsError, notifyInsufficientCredits, useInsufficientCreditsStore } from "./insufficient-credits";

test("积分判断覆盖小数、临界余额、零费用与未知报价", () => {
    assert.equal(hasInsufficientCredits("0.300001", "0.3"), true);
    assert.equal(hasInsufficientCredits("0.3", "0.300000"), false);
    assert.equal(hasInsufficientCredits("1", "2"), false);
    assert.equal(hasInsufficientCredits("0", "0"), false);
    assert.equal(hasInsufficientCredits(undefined, "0"), undefined);
    assert.equal(hasInsufficientCredits("1", null), undefined);
});

test("只识别本站积分消息，不凭错误码或供应商额度弹出购买引导", () => {
    const store = useInsufficientCreditsStore.getState();
    store.setScope("识别测试");
    for (const key of [null, "system.externalFailure", "insufficient_quota", "business.otherFailure"]) {
        assert.equal(notifyInsufficientCredits(key, "积分不足"), false);
        assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    }
    for (const key of ["business.insufficientCreditsToCreateGenerationTask", "business.insufficientCreditsFor", "business.insufficientCreditsForDeduction", "business.insufficientCreditsForStorageCapacity"]) {
        assert.equal(notifyInsufficientCredits(key, "当前钱包积分不足"), true);
        assert.equal(useInsufficientCreditsStore.getState().prompt?.message, "当前钱包积分不足");
        store.close();
    }
    assert.equal(isInsufficientCreditsError({ messageKey: "business.insufficientCreditsFor" }), true);
    assert.equal(isInsufficientCreditsError({ details: { messageKey: "business.insufficientCreditsFor" } }), true);
    assert.equal(isInsufficientCreditsError({ code: 4000, message: "积分不足" }), false);
});

test("并发不足只显示一个弹框，关闭后不重放已处理任务与请求", () => {
    const store = useInsufficientCreditsStore.getState();
    store.setScope("并发测试");
    store.show("第一个失败", "task:1");
    store.show("第二个失败", "agent:2");
    assert.deepEqual(useInsufficientCreditsStore.getState().prompt, { message: "第一个失败" });
    store.close();
    store.show("任务重放", "task:1");
    store.show("请求重放", "agent:2");
    assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    store.show("新的失败", "task:3");
    assert.equal(useInsufficientCreditsStore.getState().prompt?.message, "新的失败");
});

test("退出或切换空间清空弹框，忽略旧空间在途请求", () => {
    const store = useInsufficientCreditsStore.getState();
    store.setScope("用户1:团队1");
    store.show("旧空间失败", "task:1");
    store.setScope("用户1:团队2");
    assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    assert.equal(useInsufficientCreditsStore.getState().handledEvents.size, 0);
    store.show("迟到响应", undefined, "用户1:团队1");
    assert.equal(useInsufficientCreditsStore.getState().prompt, null);
    store.show("新空间失败", "task:1");
    assert.equal(useInsufficientCreditsStore.getState().prompt?.message, "新空间失败");
    store.setScope("visitor:0");
    assert.equal(useInsufficientCreditsStore.getState().prompt, null);
});
