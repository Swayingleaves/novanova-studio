import assert from "node:assert/strict";
import test from "node:test";

import { createScriptSaveScheduler, type ScriptSaveSchedulerStatus } from "./script-save-scheduler.ts";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

test("同一区块在防抖窗口内只保存最后一次修改", async () => {
    const saved: string[] = [];
    const scheduler = createScriptSaveScheduler({
        delayMilliseconds: 5,
        isConflict: () => false,
        onStatusChange: () => undefined,
    });
    scheduler.schedule("overview", async () => { saved.push("旧内容"); });
    scheduler.schedule("overview", async () => { saved.push("新内容"); });
    await pause(25);
    assert.deepEqual(saved, ["新内容"]);
});

test("不同区块的保存按照入队顺序串行执行", async () => {
    const saved: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = createScriptSaveScheduler({
        delayMilliseconds: 5,
        isConflict: () => false,
        onStatusChange: () => undefined,
    });
    scheduler.schedule("overview", async () => { await gate; saved.push("概览"); });
    scheduler.schedule("outline", async () => { saved.push("大纲"); });
    await pause(15);
    assert.deepEqual(saved, []);
    release?.();
    await pause(20);
    assert.deepEqual(saved, ["概览", "大纲"]);
});

test("保存失败暂停队列，用户重试后继续", async () => {
    const saved: string[] = [];
    let fail = true;
    let status: ScriptSaveSchedulerStatus | undefined;
    const scheduler = createScriptSaveScheduler({
        delayMilliseconds: 5,
        isConflict: () => false,
        onStatusChange: (next) => { status = next; },
    });
    scheduler.schedule("overview", async () => {
        if (fail) throw new Error("请求失败");
        saved.push("概览");
    });
    scheduler.schedule("outline", async () => { saved.push("大纲"); });
    await pause(20);
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
        delayMilliseconds: 5,
        isConflict: (error) => error instanceof Error && error.message === "冲突",
        onStatusChange: (next) => { statuses.push(next); },
    });
    scheduler.schedule("overview", async () => { throw new Error("冲突"); });
    await pause(20);
    assert.equal(statuses.at(-1), "conflict");
    scheduler.schedule("overview", async () => undefined);
    assert.equal(statuses.at(-1), "conflict");

    scheduler.reset();
    scheduler.schedule("old", async () => { await gate; });
    await pause(15);
    scheduler.reset();
    scheduler.schedule("new", async () => undefined);
    release?.();
    await pause(25);
    assert.equal(statuses.at(-1), "saved");
});
