import assert from "node:assert/strict";
import test from "node:test";

const { formatTaskElapsedTime, taskRecordUserLabel } = await import(new URL("./task-record-utils.ts", import.meta.url).href);

const createdAt = "2026-07-02T12:00:00.000Z";

function completedAfter(seconds: number) {
    return new Date(Date.parse(createdAt) + seconds * 1000).toISOString();
}

test("管理员任务记录用户名称优先显示昵称", () => {
    assert.equal(taskRecordUserLabel({ nickname: "创作者", username: "creator", email: "creator@example.com" }), "创作者");
});

test("任务记录用户名称依次回退到用户名、邮箱和占位符", () => {
    assert.equal(taskRecordUserLabel({ nickname: null, username: "creator", email: "creator@example.com" }), "creator");
    assert.equal(taskRecordUserLabel({ nickname: null, username: "", email: "creator@example.com" }), "creator@example.com");
    assert.equal(taskRecordUserLabel({ nickname: null, username: "", email: null }), "—");
});

test("任务耗时不足一分钟时只显示秒", () => {
    assert.equal(formatTaskElapsedTime(createdAt, completedAfter(10)), "10s");
    assert.equal(formatTaskElapsedTime(createdAt, completedAfter(0)), "0s");
    assert.equal(formatTaskElapsedTime(createdAt, completedAfter(59.9)), "59s");
});

test("任务耗时达到一分钟时显示分钟和剩余秒", () => {
    assert.equal(formatTaskElapsedTime(createdAt, completedAfter(60)), "1分0s");
    assert.equal(formatTaskElapsedTime(createdAt, completedAfter(70)), "1分10s");
    assert.equal(formatTaskElapsedTime(createdAt, completedAfter(125)), "2分5s");
});

test("任务未完成或完成时间早于创建时间时不显示耗时", () => {
    assert.equal(formatTaskElapsedTime(createdAt, null), "—");
    assert.equal(formatTaskElapsedTime(createdAt, undefined), "—");
    assert.equal(formatTaskElapsedTime(createdAt, completedAfter(-1)), "—");
});
