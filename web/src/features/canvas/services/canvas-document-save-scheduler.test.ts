import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasDocument } from "../domain/canvas-document.ts";
import { createCanvasDocumentSaveScheduler } from "./canvas-document-save-scheduler.ts";

test("同一文档连续调度只保存最后一次状态", async () => {
    const savedTitles: string[] = [];
    const scheduler = createCanvasDocumentSaveScheduler({
        delayMilliseconds: 5,
        saveDocument: async (document) => {
            savedTitles.push(document.identity.title);
        },
        onError: () => assert.fail("不应保存失败"),
    });
    const first = createCanvasDocument({ id: "document-1", title: "第一次", now: "2026-07-12T00:00:00.000Z" });
    const second = {
        ...first,
        identity: { ...first.identity, title: "第二次" },
    };

    scheduler.schedule(first);
    scheduler.schedule(second);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(savedTitles, ["第二次"]);
});

test("同一文档的立即保存按调用顺序串行执行", async () => {
    const savedTitles: string[] = [];
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveGate = new Promise<void>((resolve) => {
        releaseFirstSave = resolve;
    });
    const scheduler = createCanvasDocumentSaveScheduler({
        delayMilliseconds: 5,
        saveDocument: async (document) => {
            if (document.identity.title === "第一次") await firstSaveGate;
            savedTitles.push(document.identity.title);
        },
        onError: () => assert.fail("不应保存失败"),
    });
    const first = createCanvasDocument({ id: "document-1", title: "第一次", now: "2026-07-12T00:00:00.000Z" });
    const second = {
        ...first,
        identity: { ...first.identity, title: "第二次" },
    };

    const firstSaving = scheduler.saveNow(first);
    const secondSaving = scheduler.saveNow(second);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(savedTitles, []);

    releaseFirstSave?.();
    await Promise.all([firstSaving, secondSaving]);

    assert.deepEqual(savedTitles, ["第一次", "第二次"]);
});
