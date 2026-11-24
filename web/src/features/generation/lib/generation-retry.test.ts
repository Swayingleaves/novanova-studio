import assert from "node:assert/strict";
import test from "node:test";

const { isGenerationRetryMessage, selectGenerationAttachments, selectVideoGenerationAttachments } = await import(new URL("./generation-retry.ts", import.meta.url).href);

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

test("英文重试按钮继续复用参考素材，普通英文消息保持原有规则", () => {
    const previous = [{ url: "https://storage.example.com/reference.png", type: "image/png", name: "reference.png" }];
    assert.equal(isGenerationRetryMessage("Retry!"), true);
    assert.equal(isGenerationRetryMessage("Generate again."), true);
    assert.deepEqual(selectGenerationAttachments("Regenerate", [], previous), previous);
    assert.deepEqual(selectGenerationAttachments("Add a cat", [], previous), []);
});

test("视频对话在需要参考素材的模式下未重新选图时自动复用本对话历史素材", () => {
    const previous = [{ url: "https://storage.example.com/reference.png", type: "image/png", name: "reference.png" }];
    const current = [{ url: "https://storage.example.com/new.png", type: "image/png", name: "new.png" }];

    assert.deepEqual(selectVideoGenerationAttachments("image-to-video", [], previous), previous);
    assert.deepEqual(selectVideoGenerationAttachments("reference-to-video", [], previous), previous);
    assert.deepEqual(selectVideoGenerationAttachments("first-last-frame-to-video", [], previous), previous);
    assert.deepEqual(selectVideoGenerationAttachments("image-to-video", current, previous), current);
    assert.deepEqual(selectVideoGenerationAttachments("text-to-video", [], previous), []);
});
