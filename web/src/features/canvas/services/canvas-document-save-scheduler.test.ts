import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasDocument } from "../domain/canvas-document.ts";
import { createCanvasDocumentSaveScheduler } from "./canvas-document-save-scheduler.ts";

test("分享要求的立即保存向调用方传递失败，失败后仍能保存新版本", async () => {
    let fail = true;
    const errors: unknown[] = [];
    const scheduler = createCanvasDocumentSaveScheduler({ delayMilliseconds: 5, saveDocument: async () => { if (fail) throw new Error("保存失败"); }, onError: (_, error) => errors.push(error) });
    const document = createCanvasDocument({ id: "shared", title: "分享", now: "2026-11-06T00:00:00Z" });
    await assert.rejects(scheduler.saveNow(document, true), /保存失败/);
    assert.equal(errors.length, 1);
    fail = false;
    await scheduler.saveNow(document, true);
});

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
