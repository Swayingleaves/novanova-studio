import assert from "node:assert/strict";
import test from "node:test";

import {
    createCanvasDocument,
    removeCanvasDocuments,
    renameCanvasDocument,
    replaceCanvasConversation,
    replaceCanvasScene,
    updateCanvasPreferences,
} from "./canvas-document.ts";

test("新画布文档具有分组的空场景、会话和偏好", () => {
    const document = createCanvasDocument({
        id: "document-1",
        title: "测试画布",
        now: "2026-07-12T00:00:00.000Z",
    });

    assert.equal(document.identity.id, "document-1");
    assert.equal(document.identity.title, "测试画布");
    assert.deepEqual(document.scene.nodes, []);
    assert.deepEqual(document.scene.connections, []);
    assert.deepEqual(document.scene.viewport, { offsetX: 0, offsetY: 0, zoom: 1 });
    assert.deepEqual(document.conversation, { sessions: [], activeSessionId: null });
    assert.deepEqual(document.preferences, { background: "dots", showImageInformation: false });
});

test("替换场景不会修改会话和偏好", () => {
    const original = createCanvasDocument({
        id: "document-1",
        title: "测试",
        now: "2026-07-12T00:00:00.000Z",
    });
    const scene = {
        ...original.scene,
        viewport: { offsetX: 10, offsetY: 20, zoom: 1.5 },
    };

    const updated = replaceCanvasScene(original, scene, "2026-07-12T01:00:00.000Z");

    assert.equal(updated.scene, scene);
    assert.equal(updated.conversation, original.conversation);
    assert.equal(updated.preferences, original.preferences);
    assert.equal(updated.identity.updatedAt, "2026-07-12T01:00:00.000Z");
});

test("空标题不会覆盖原有标题", () => {
    const original = createCanvasDocument({
        id: "document-1",
        title: "原标题",
        now: "2026-07-12T00:00:00.000Z",
    });

    const updated = renameCanvasDocument(original, "   ", "2026-07-12T01:00:00.000Z");

    assert.equal(updated.identity.title, "原标题");
    assert.equal(updated, original);
});

test("替换助手会话只修改会话分组", () => {
    const original = createCanvasDocument({ id: "document-1", title: "测试", now: "2026-07-12T00:00:00.000Z" });
    const conversation = { sessions: [], activeSessionId: "session-1" };

    const updated = replaceCanvasConversation(original, conversation, "2026-07-12T01:00:00.000Z");

    assert.equal(updated.conversation, conversation);
    assert.equal(updated.scene, original.scene);
    assert.equal(updated.preferences, original.preferences);
});

test("更新画布偏好只修改偏好分组", () => {
    const original = createCanvasDocument({ id: "document-1", title: "测试", now: "2026-07-12T00:00:00.000Z" });
    const preferences = { background: "dots" as const, showImageInformation: true };

    const updated = updateCanvasPreferences(original, preferences, "2026-07-12T01:00:00.000Z");

    assert.equal(updated.preferences, preferences);
    assert.equal(updated.scene, original.scene);
    assert.equal(updated.conversation, original.conversation);
});

test("删除文档只移除指定标识", () => {
    const first = createCanvasDocument({ id: "document-1", title: "一", now: "2026-07-12T00:00:00.000Z" });
    const second = createCanvasDocument({ id: "document-2", title: "二", now: "2026-07-12T00:00:00.000Z" });

    const remaining = removeCanvasDocuments([first, second], ["document-1"]);

    assert.deepEqual(remaining, [second]);
});
