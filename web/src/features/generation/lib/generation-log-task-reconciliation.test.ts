import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { reconcileGenerationLogTasks } from "./generation-log-task-reconciliation";

/** 模拟任务查询，恢复历史只能读取任务，任何回写都会使测试失败。 */
function mockTaskQueries(context: TestContext, tasks: Record<string, { status: string; resultData?: unknown; errorMessage?: string }>) {
    const requests: string[] = [];
    context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
        const url = new URL(String(input));
        requests.push(`${options?.method} ${url.pathname}`);
        assert.equal(options?.method, "GET", "读取历史不能回写旧生成快照");
        assert.equal(url.pathname, "/api/v1/ai/task/getTaskInfo");
        const taskId = url.searchParams.get("taskId") || "";
        assert.ok(tasks[taskId], `不应查询无关任务：${taskId}`);
        return new Response(JSON.stringify({ code: 0, data: { id: taskId, progress: 100, ...tasks[taskId] }, msg: "ok" }), {
            headers: { "Content-Type": "application/json" },
        });
    });
    return requests;
}

/** 构造生成过程中切走后读取到的历史快照。 */
function imageLog(status = "pending") {
    return {
        id: "conversation-1",
        title: "生成图片",
        generationStatus: status === "pending" ? "running" : status,
        rounds: [{ id: "round-1", taskId: "task-1", results: [{ id: "result-1", status, taskId: "task-1", progress: 35 }] }],
    };
}

test("切回页面时从成功任务恢复图片和全部媒体信息，不把旧快照回写到服务端", async (context) => {
    const media = {
        url: "https://example.com/result.png", storageKey: "image:result-1", width: 720, height: 1280,
        bytes: 2291850, mimeType: "image/png", durationMs: 0,
        objectStorage: { url: "https://storage.example.com/result.png" },
    };
    const requests = mockTaskQueries(context, { "task-1": { status: "success", resultData: { items: [media] } } });
    const original = imageLog();
    const snapshot = structuredClone(original);

    const [restored] = await reconcileGenerationLogTasks("image", [original]);
    const result = restored.rounds[0].results[0] as Record<string, unknown>;

    assert.equal(restored.generationStatus, "success");
    assert.equal(result.status, "success");
    assert.equal(result.progress, 100);
    assert.deepEqual(result.image, { ...media, id: media.storageKey, dataUrl: media.url });
    assert.deepEqual(original, snapshot, "后台仍可能更新记录，恢复过程不能修改原始快照");
    assert.deepEqual(requests, ["GET /api/v1/ai/task/getTaskInfo"]);
});

test("历史已被标记成功但缺少图片时仍查询任务，恢复后再次读取不重复查询", async (context) => {
    const requests = mockTaskQueries(context, { "task-1": { status: "success", resultData: { item: { url: "https://example.com/result.png" } } } });
    const [restored] = await reconcileGenerationLogTasks("image", [imageLog("success")]);

    const result = restored.rounds[0].results[0] as Record<string, unknown>;
    assert.equal((result.image as Record<string, unknown>).dataUrl, "https://example.com/result.png");
    const [reloaded] = await reconcileGenerationLogTasks("image", [restored]);
    assert.strictEqual(reloaded, restored);
    assert.equal(requests.length, 1);
});

test("一个任务的多张图片全部恢复，重复进入页面时结果标识不变", async (context) => {
    mockTaskQueries(context, { "task-1": { status: "success", resultData: { items: [
        { url: "https://example.com/first.png" }, { url: "https://example.com/second.png" },
    ] } } });

    const [first] = await reconcileGenerationLogTasks("image", [imageLog()]);
    const [second] = await reconcileGenerationLogTasks("image", [imageLog()]);
    assert.deepEqual(first, second);
    assert.deepEqual(first.rounds[0].results.map((result) => result.id), ["result-1", "result-1-1"]);
    assert.deepEqual(first.rounds[0].results.map((result) => ((result as Record<string, unknown>).image as Record<string, unknown>).dataUrl), [
        "https://example.com/first.png", "https://example.com/second.png",
    ]);
});

test("完整成功结果和纯对话轮次保持原值，不查询无关任务", async (context) => {
    const requests = mockTaskQueries(context, {});
    const original = {
        id: "conversation-1", rounds: [
            { id: "round-1", taskId: "task-1", results: [{ id: "result-1", status: "success", image: { dataUrl: "https://example.com/saved.png" } }] },
            { id: "round-2", results: [], assistantText: "选择一个风格" },
        ],
    };

    const [restored] = await reconcileGenerationLogTasks("image", [original]);
    assert.strictEqual(restored, original);
    assert.equal(requests.length, 0);
});

test("仍在执行的任务保持生成中，下一次任务完成时才恢复图片", async (context) => {
    const tasks = { "task-1": { status: "running", resultData: {} } };
    mockTaskQueries(context, tasks);
    const original = imageLog();

    const [running] = await reconcileGenerationLogTasks("image", [original]);
    assert.strictEqual(running, original);
    tasks["task-1"] = { status: "success", resultData: { items: [{ url: "https://example.com/finished.png" }] } };
    const [finished] = await reconcileGenerationLogTasks("image", [running]);
    assert.equal(finished.rounds[0].results[0].status, "success");
    assert.ok((finished.rounds[0].results[0] as Record<string, unknown>).image);
});

test("失败和取消任务停止等待并保留服务端原因", async (context) => {
    mockTaskQueries(context, {
        "task-1": { status: "failed", errorMessage: "供应商拒绝请求" },
        "task-2": { status: "canceled", errorMessage: "用户停止生成" },
    });
    const original = imageLog();
    original.rounds[0].results.push({ id: "result-2", taskId: "task-2", status: "pending", progress: 0 });

    const [restored] = await reconcileGenerationLogTasks("image", [original]);
    assert.deepEqual(restored.rounds[0].results.map((result) => [result.status, (result as Record<string, unknown>).error]), [
        ["failed", "供应商拒绝请求"], ["canceled", "用户停止生成"],
    ]);
    assert.equal(restored.generationStatus, "failed");
});

test("成功任务实际没有返回图片时明确显示错误，不能继续转圈", async (context) => {
    mockTaskQueries(context, { "task-1": { status: "success", resultData: { items: [] } } });
    const [restored] = await reconcileGenerationLogTasks("image", [imageLog()]);
    assert.equal(restored.rounds[0].results[0].status, "failed");
    assert.equal((restored.rounds[0].results[0] as Record<string, unknown>).error, "图片任务已完成，但没有返回图片");
    assert.equal(restored.generationStatus, "failed");
});

test("视频历史共用恢复逻辑时保留视频地址与存储信息", async (context) => {
    const media = { url: "https://example.com/result.mp4", storageKey: "video:result", durationMs: 5000 };
    mockTaskQueries(context, { "task-1": { status: "success", resultData: { item: media } } });
    const original = { id: "video-conversation", rounds: [{ taskId: "task-1", result: { id: "video-result", status: "pending" } }] };

    const [restored] = await reconcileGenerationLogTasks("video", [original]);
    assert.deepEqual((restored.rounds[0].result as Record<string, unknown>).video, { ...media, id: media.storageKey });
    assert.equal(restored.rounds[0].result.status, "success");
});

test("同一任务在多个记录中出现时只查询一次，缺失任务标识明确失败", async (context) => {
    const requests = mockTaskQueries(context, { "task-1": { status: "success", resultData: { item: { url: "https://example.com/result.png" } } } });
    const missing = imageLog();
    missing.rounds[0].taskId = "";
    missing.rounds[0].results[0].taskId = "";

    const restored = await reconcileGenerationLogTasks("image", [imageLog(), imageLog("success"), missing]);
    assert.equal(requests.length, 1);
    assert.equal(restored[2].rounds[0].results[0].status, "failed");
    assert.equal((restored[2].rounds[0].results[0] as Record<string, unknown>).error, "生成任务标识缺失，无法查询任务状态");
});

test("任务查询失败时保留原记录，不能把网络异常当作生成失败", async (context) => {
    context.mock.method(globalThis, "fetch", async () => { throw new Error("网络中断"); });
    context.mock.method(console, "error", () => {});
    const original = imageLog();
    const [restored] = await reconcileGenerationLogTasks("image", [original]);
    assert.strictEqual(restored, original);
});
