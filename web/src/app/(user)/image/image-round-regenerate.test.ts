import assert from "node:assert/strict";
import test from "node:test";

const { buildImageRoundRegeneratePayload, regenerateImageRound } = await import(new URL("./image-round-regenerate.ts", import.meta.url).href);

test("buildImageRoundRegeneratePayload 保留历史配置与参考图", () => {
    const payload = buildImageRoundRegeneratePayload(
        {
            prompt: "生成一只坐在窗边的黑猫",
            config: {
                size: "16:9",
                quality: "high",
                imageResolution: "4K",
                imageModel: "image-model-pro",
            },
            references: [
                {
                    id: "reference-1",
                    name: "cat.png",
                    type: "image/png",
                    dataUrl: "https://example.com/cat.png",
                },
            ],
        },
        "fallback-model",
    );

    assert.equal(payload.prompt, "生成一只坐在窗边的黑猫");
    assert.equal(payload.contextualPrompt, "[用户设置：尺寸=16:9，清晰度=4K，质量=high，生图模型=image-model-pro]\n\n生成一只坐在窗边的黑猫");
    assert.deepEqual(payload.attachments, [
        {
            url: "https://example.com/cat.png",
            type: "image/png",
            name: "cat.png",
        },
    ]);
});

test("regenerateImageRound 会追加用户消息并发送重新生成请求", async () => {
    const userMessages: string[] = [];
    const sendCalls: Array<{ message: string; attachments?: { url: string; type: string; name: string }[] }> = [];

    await regenerateImageRound(
        {
            prompt: "生成一张极简海报",
            config: {},
            references: [],
        },
        {
            fallbackModel: "default-image-model",
            appendUserMessage: (message) => {
                userMessages.push(message);
            },
            sendMessage: async (message, attachments) => {
                sendCalls.push({ message, attachments });
            },
        },
    );

    assert.deepEqual(userMessages, ["生成一张极简海报"]);
    assert.deepEqual(sendCalls, [
        {
            message: "[用户设置：尺寸=1:1，清晰度=2K，质量=high，生图模型=default-image-model]\n\n生成一张极简海报",
            attachments: undefined,
        },
    ]);
});
