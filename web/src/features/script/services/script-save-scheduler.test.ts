import assert from "node:assert/strict";
import test from "node:test";

import { createScriptSaveScheduler, type ScriptSaveSchedulerStatus } from "./script-save-scheduler.ts";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

test("schedule 只标记脏，不会自己发请求", async () => {
    const saved: string[] = [];
    const statuses: ScriptSaveSchedulerStatus[] = [];
    const scheduler = createScriptSaveScheduler({
        isConflict: () => false,
        onStatusChange: (next) => { statuses.push(next); },
    });
    scheduler.schedule("overview", async () => { saved.push("概览"); });
    scheduler.schedule("outline", async () => { saved.push("大纲"); });
    await pause(30);
    assert.deepEqual(saved, [], "没有任何显式保存时不应发出请求");
    assert.equal(statuses.at(-1), "dirty");
    assert.equal(scheduler.hasPending(), true);
});

test("连续登记同一区块只保留最后一次修改，flush 后只执行一次", async () => {
    const saved: string[] = [];
    const scheduler = createScriptSaveScheduler({
        isConflict: () => false,
        onStatusChange: () => undefined,
    });
    scheduler.schedule("overview", async () => { saved.push("旧内容"); });
    scheduler.schedule("overview", async () => { saved.push("新内容"); });
    await scheduler.flush();
    assert.deepEqual(saved, ["新内容"]);
    assert.equal(scheduler.hasPending(), false);
});

test("不同区块的保存按照入队顺序串行执行", async () => {
    const saved: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = createScriptSaveScheduler({
        isConflict: () => false,
        onStatusChange: () => undefined,
    });
    scheduler.schedule("overview", async () => { await gate; saved.push("概览"); });
    scheduler.schedule("outline", async () => { saved.push("大纲"); });
    const flushing = scheduler.flush();
    await pause(15);
    assert.deepEqual(saved, [], "概览还在等待释放时不应插队执行大纲");
    release?.();
    await flushing;
    assert.deepEqual(saved, ["概览", "大纲"]);
});

test("保存失败时 flush 返回 false，队列保留以便重试", async () => {
    const saved: string[] = [];
    let fail = true;
    let status: ScriptSaveSchedulerStatus | undefined;
    const scheduler = createScriptSaveScheduler({
        isConflict: () => false,
        onStatusChange: (next) => { status = next; },
    });
    scheduler.schedule("overview", async () => {
        if (fail) throw new Error("请求失败");
        saved.push("概览");
    });
    scheduler.schedule("outline", async () => { saved.push("大纲"); });

    assert.equal(await scheduler.flush(), false);
    assert.equal(status, "error");
    assert.deepEqual(saved, []);
    fail = false;
    scheduler.retry();
    await pause(20);
    assert.equal(status, "saved");
    assert.deepEqual(saved, ["概览", "大纲"]);
});

test("冲突期间新增编辑不清除冲突状态，重置后旧请求不能污染新项目", async () => {
    const statuses: ScriptSaveSchedulerStatus[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = createScriptSaveScheduler({
        isConflict: (error) => error instanceof Error && error.message === "冲突",
        onStatusChange: (next) => { statuses.push(next); },
    });
    scheduler.schedule("overview", async () => { throw new Error("冲突"); });
    await scheduler.flush();
    assert.equal(statuses.at(-1), "conflict");
    scheduler.schedule("overview", async () => undefined);
    assert.equal(statuses.at(-1), "conflict");

    scheduler.reset();
    // 旧任务挂在 gate 上不放行，reset 期间发起；随后新项目的保存必须不受它影响
    scheduler.schedule("old", async () => { await gate; });
    const stale = scheduler.flush();
    scheduler.reset();
    scheduler.schedule("new", async () => undefined);
    await scheduler.flush();
    assert.equal(statuses.at(-1), "saved");
    release?.();
    await stale;
    // 旧请求收尾也不能把状态改回 dirty 或 saved，新项目该保持 saved
    assert.equal(statuses.at(-1), "saved");
});

test("reset 清空待保存内容，resume 不会偷偷发请求", async () => {
    const saved: string[] = [];
    const scheduler = createScriptSaveScheduler({
        isConflict: () => false,
        onStatusChange: () => undefined,
    });
    scheduler.schedule("overview", async () => { saved.push("概览"); });
    scheduler.reset();
    assert.equal(scheduler.hasPending(), false);
    scheduler.resume();
    await pause(20);
    assert.deepEqual(saved, []);
});
