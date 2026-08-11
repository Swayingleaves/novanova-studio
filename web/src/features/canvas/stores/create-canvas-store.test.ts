import assert from "node:assert/strict";
import test from "node:test";

import { createStoryboardNode, createTextNode } from "../constants.ts";
import type { CanvasDocumentPersistence } from "../services/canvas-document-persistence.ts";
import type { CanvasScene } from "../types.ts";
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

test("分镜节点及其剧本连线可随画布场景序列化保存", () => {
    const scheduledScenes: CanvasScene[] = [];
    const store = createCanvasStore({
        createId: () => "document-1",
        createTimestamp: () => "2026-08-08T00:00:00.000Z",
        persistence: createMemoryPersistence(),
        onDeleteError: () => assert.fail("不应删除失败"),
        saveScheduler: {
            saveNow: async () => undefined,
            schedule: (document) => scheduledScenes.push(document.scene),
            cancel: () => undefined,
        },
    });
    const documentId = store.getState().createDocument("分镜画布");
    const script = createTextNode({ id: "text-1", position: { x: 0, y: 0 }, text: "侦探在雨夜追逐嫌疑人。" });
    const storyboard = createStoryboardNode({ id: "storyboard-1", position: { x: 440, y: 0 } });
    storyboard.content = { instruction: "生成雨夜追逐片段", visualStyle: "国风手绘厚涂", model: "channel-1::story-model" };
    storyboard.storyboard = {
        shots: [{ id: "shot-1", shotNumber: 1, durationSeconds: 5, visualDescription: "雨夜街道", shotSize: "远景", lightingAtmosphere: "霓虹反光", dialogueVoiceover: "别跑", soundEffect: "雨声", cameraMovement: "推进", finalPrompt: "雨夜街道远景，侦探追逐嫌疑人，霓虹反光，镜头推进。", assetIds: ["asset-1"] }],
        assets: [{ id: "asset-1", kind: "character", name: "侦探", description: "黑色风衣" }],
    };
    const scene: CanvasScene = {
        nodes: [script, storyboard],
        connections: [{ id: "connection-1", source: { nodeId: script.id }, target: { nodeId: storyboard.id } }],
        viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    };

    store.getState().replaceScene(documentId, scene);
    const serializedScene = JSON.parse(JSON.stringify(store.getState().findDocument(documentId)?.scene)) as CanvasScene;
    const restoredStoryboard = serializedScene.nodes.find((node) => node.id === storyboard.id);

    assert.equal(restoredStoryboard?.kind, "storyboard");
    if (!restoredStoryboard || restoredStoryboard.kind !== "storyboard") throw new Error("应恢复分镜节点");
    assert.equal(restoredStoryboard.content.instruction, "生成雨夜追逐片段");
    assert.equal(restoredStoryboard.content.visualStyle, "国风手绘厚涂");
    assert.equal(restoredStoryboard.storyboard.shots[0].finalPrompt, "雨夜街道远景，侦探追逐嫌疑人，霓虹反光，镜头推进。");
    assert.deepEqual(restoredStoryboard.storyboard.shots[0].assetIds, ["asset-1"]);
    assert.equal(restoredStoryboard.storyboard.assets[0].name, "侦探");
    assert.equal(serializedScene.connections[0].target.nodeId, storyboard.id);
    assert.equal(scheduledScenes.length, 1);
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
