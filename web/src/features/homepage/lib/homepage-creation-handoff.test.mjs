import assert from "node:assert/strict";
import { test } from "node:test";
import { applyHomepageCreationSettings, clearHomepageCreationHandoff, consumeHomepageCreationHandoff, parseHomepageCreationDraft, peekHomepageCreationHandoff, storeHomepageCreationHandoff } from "./homepage-creation-handoff.ts";

function installStorage() {
    const data = new Map();
    const storage = {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
    };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
    return storage;
}

const image = { id: "img-1", name: "参考图", type: "image/png", dataUrl: "https://cdn.example/a.png", storageKey: "image:1" };
const video = { id: "video-1", name: "参考视频", type: "video/mp4", url: "https://cdn.example/a.mp4" };
const imageSettings = { quality: "high", imageResolution: "4K", size: "3:4", count: "1", imageModel: "image-model" };
const videoSettings = { videoGenerationMode: "image-to-video", vquality: "1080p", size: "9:16", videoSeconds: "8", videoWatermark: "false", videoModel: "video-model" };

test("首页创作草稿只在目标页面读取，并在确认开始后删除", () => {
    installStorage();
    const stored = storeHomepageCreationHandoff({
        target: "video",
        prompt: "  缓慢推进  ",
        creationMode: "chat",
        styles: [{ id: 3, name: "电影", generationType: "video", coverUrl: "", category: "" }],
        skill: { id: 8, name: "运镜", description: "", targetType: "video", coverUrl: "" },
        images: [image, { ...image, id: "blob", dataUrl: "blob:local" }],
        videos: [video],
        videoSettings,
    });
    assert.equal(stored, false);
    assert.equal(peekHomepageCreationHandoff("video"), null);

    assert.equal(storeHomepageCreationHandoff({
        target: "video",
        prompt: "缓慢推进",
        creationMode: "chat",
        styles: [{ id: 3, name: "电影", generationType: "video", coverUrl: "", category: "" }],
        skill: { id: 8, name: "运镜", description: "", targetType: "video", coverUrl: "" },
        images: [image],
        videos: [video],
        videoSettings,
    }), true);
    assert.equal(peekHomepageCreationHandoff("image"), null);
    assert.equal(peekHomepageCreationHandoff("video")?.prompt, "缓慢推进");
    assert.equal(consumeHomepageCreationHandoff("image"), null);
    assert.equal(peekHomepageCreationHandoff("video")?.creationMode, "chat");
    assert.deepEqual(consumeHomepageCreationHandoff("video")?.videos, [video]);
    assert.equal(peekHomepageCreationHandoff("video"), null);
});

test("损坏草稿和本地临时地址不会被当成可生成内容", () => {
    installStorage();
    sessionStorage.setItem("novanova:homepage-creation-handoff", "{");
    assert.equal(peekHomepageCreationHandoff("image"), null);
    assert.equal(parseHomepageCreationDraft({ target: "image", prompt: "   ", images: [] }), null);
    assert.equal(parseHomepageCreationDraft({ target: "image", prompt: "海报", images: [{ id: "1", name: "a", type: "image/png", dataUrl: "blob:x" }] })?.images.length, 0);
    clearHomepageCreationHandoff();
    assert.equal(peekHomepageCreationHandoff("image"), null);
});

test("草稿设置写回配置时，空模型保留页面已恢复的模型", () => {
    const updates = [];
    applyHomepageCreationSettings({
        target: "image",
        prompt: "海报",
        creationMode: "agent",
        styles: [],
        skill: null,
        images: [],
        videos: [],
        imageSettings: { ...imageSettings, imageModel: "" },
    }, (key, value) => updates.push([key, value]));
    assert.deepEqual(updates, [["quality", "high"], ["imageResolution", "4K"], ["size", "3:4"], ["count", "1"]]);
});
