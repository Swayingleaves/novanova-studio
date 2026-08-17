import assert from "node:assert/strict";
import test from "node:test";

const { isGenerationRetryMessage, selectGenerationAttachments } = await import(new URL("./generation-retry.ts", import.meta.url).href);

test("明确重试且当前未选择附件时复用上一轮附件", () => {
    const previous = [{ url: "https://storage.example.com/reference.png", type: "image/png", name: "reference.png" }];

    assert.equal(isGenerationRetryMessage("重试！"), true);
    assert.deepEqual(selectGenerationAttachments("重试！", [], previous), previous);
});

test("普通输入或当前已选择附件时不继承上一轮附件", () => {
    const current = [{ url: "https://storage.example.com/current.png", type: "image/png", name: "current.png" }];
    const previous = [{ url: "https://storage.example.com/previous.png", type: "image/png", name: "previous.png" }];

    assert.deepEqual(selectGenerationAttachments("继续优化人物表情", [], previous), []);
    assert.deepEqual(selectGenerationAttachments("重试", current, previous), current);
});
