import assert from "node:assert/strict";
import test from "node:test";

import type { CanvasDocumentPersistence } from "../services/canvas-document-persistence.ts";
import { createCanvasStore } from "./create-canvas-store.ts";

test("新建画布文档立即写入状态并保存", () => {
    const savedDocumentIds: string[] = [];
    const store = createCanvasStore({
        createId: () => "document-1",
        createTimestamp: () => "2026-07-12T00:00:00.000Z",
        persistence: createMemoryPersistence(),
        onDeleteError: () => assert.fail("不应删除失败"),
        saveScheduler: {
            saveNow: async (document) => {
                savedDocumentIds.push(document.identity.id);
            },
            schedule: () => undefined,
            cancel: () => undefined,
        },
    });

    const documentId = store.getState().createDocument("测试画布");

    assert.equal(documentId, "document-1");
    assert.equal(store.getState().documents[0].identity.title, "测试画布");
    assert.deepEqual(savedDocumentIds, ["document-1"]);
});

test("并发加载画布文档只请求一次", async () => {
    let loadCount = 0;
    let releaseLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
        releaseLoad = resolve;
    });
    const persistence = createMemoryPersistence();
    persistence.loadDocuments = async () => {
        loadCount += 1;
        await loadGate;
        return [];
    };
    const store = createCanvasStore({
        createId: () => "document-1",
        createTimestamp: () => "2026-07-12T00:00:00.000Z",
        persistence,
        onDeleteError: () => assert.fail("不应删除失败"),
        saveScheduler: {
            saveNow: async () => undefined,
            schedule: () => undefined,
            cancel: () => undefined,
        },
    });

    const firstLoading = store.getState().hydrateDocuments();
    const secondLoading = store.getState().hydrateDocuments();
    assert.equal(loadCount, 1);

    releaseLoad?.();
    await Promise.all([firstLoading, secondLoading]);

    assert.equal(store.getState().hydrated, true);
});

test("删除持久化失败时通过依赖明确上报", async () => {
    const errors: unknown[] = [];
    const persistence = createMemoryPersistence();
    persistence.deleteDocuments = async () => {
        throw new Error("删除失败");
    };
    const store = createCanvasStore({
        createId: () => "document-1",
        createTimestamp: () => "2026-07-12T00:00:00.000Z",
        persistence,
        onDeleteError: (_documentIds, error) => errors.push(error),
        saveScheduler: {
            saveNow: async () => undefined,
            schedule: () => undefined,
            cancel: () => undefined,
        },
    });

    store.getState().deleteDocuments(["document-1"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(errors.length, 1);
});

function createMemoryPersistence(): CanvasDocumentPersistence {
    return {
        loadDocuments: async () => [],
        saveDocument: async () => undefined,
        deleteDocuments: async () => undefined,
    };
}
