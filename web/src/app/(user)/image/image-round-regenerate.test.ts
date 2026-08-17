import assert from "node:assert/strict";
import test from "node:test";

const { buildImageRoundRegeneratePayload, regenerateImageRound } = await import(new URL("./image-round-regenerate.ts", import.meta.url).href);

test("buildImageRoundRegeneratePayload 保留历史配置与参考图并固定单图数量", () => {
    const payload = buildImageRoundRegeneratePayload(
        {
            prompt: "生成一只坐在窗边的黑猫",
            config: {
                size: "16:9",
                quality: "high",
                imageResolution: "4K",
                imageModel: "image-model-pro",
                count: "2",
            },
            references: [
                {
                    id: "reference-1",
                    name: "cat.png",
                    type: "image/png",
                    dataUrl: "https://example.com/cat.png",
                    storageKey: "image:cat",
                },
            ],
        },
        "fallback-model",
    );

    assert.equal(payload.prompt, "生成一只坐在窗边的黑猫");
    assert.deepEqual(payload.creationSettings, {
        model: "image-model-pro",
        size: "16:9",
        resolution: "4K",
        quality: "high",
        count: 1,
    });
    assert.deepEqual(payload.attachments, [
        {
            url: "https://example.com/cat.png",
            type: "image/png",
            name: "cat.png",
            storageKey: "image:cat",
        },
    ]);
});

test("buildImageRoundRegeneratePayload 保留仅含公开 URL 的历史参考图", () => {
    const payload = buildImageRoundRegeneratePayload(
        {
            prompt: "使用参考图生成海报",
            config: {},
            references: [
                {
                    id: "recent-reference-1",
                    name: "最近上传的参考图",
                    type: "image/webp",
                    dataUrl: "",
                    url: "https://storage.example.com/recent-reference.webp",
                },
            ],
        },
        "fallback-model",
    );

    assert.deepEqual(payload.attachments, [
        {
            url: "https://storage.example.com/recent-reference.webp",
            type: "image/webp",
            name: "最近上传的参考图",
        },
    ]);
});

test("regenerateImageRound 会追加用户消息并发送重新生成请求", async () => {
    const userMessages: string[] = [];
    const sendCalls: Array<{ message: string; attachments?: { url: string; type: string; name: string }[]; creationSettings?: Record<string, unknown> }> = [];

    await regenerateImageRound(
        {
            prompt: "生成一张极简海报",
            config: {},
            references: [],
        },
        {
            fallbackModel: "default-image-model",
            appendUserMessage: (message: string) => {
                userMessages.push(message);
            },
            sendMessage: async (
                message: string,
                attachments?: { url: string; type: string; name: string; storageKey?: string }[],
                creationSettings?: Record<string, unknown>,
            ) => {
                sendCalls.push({ message, attachments, creationSettings });
            },
        },
    );

    assert.deepEqual(userMessages, ["生成一张极简海报"]);
    assert.deepEqual(sendCalls, [
        {
            message: "生成一张极简海报",
            attachments: undefined,
            creationSettings: {
                model: "default-image-model",
                count: 1,
            },
        },
    ]);
});

test("buildImageRoundRegeneratePayload 只携带历史风格快照，不重新提交风格ID", () => {
    const snapshots = [{ id: 7, name: "电影感", generationType: "image" as const, stylePrompt: "cinematic" }];
    const payload = buildImageRoundRegeneratePayload(
        {
            prompt: "生成一张海报",
            config: {},
            references: [],
            generationStyleSnapshots: snapshots,
        },
        "fallback-model",
    );

    assert.deepEqual(payload.creationSettings, {
        model: "fallback-model",
        count: 1,
        generationStyleSnapshots: snapshots,
    });
    assert.equal("generationStyleIds" in payload.creationSettings, false);
});
