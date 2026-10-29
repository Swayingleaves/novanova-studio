import assert from "node:assert/strict";
import test from "node:test";

const { taskRecordUserLabel } = await import(new URL("./task-record-utils.ts", import.meta.url).href);

test("管理员任务记录用户名称优先显示昵称", () => {
    assert.equal(taskRecordUserLabel({ nickname: "创作者", username: "creator", email: "creator@example.com" }), "创作者");
});

test("任务记录用户名称依次回退到用户名、邮箱和占位符", () => {
    assert.equal(taskRecordUserLabel({ nickname: null, username: "creator", email: "creator@example.com" }), "creator");
    assert.equal(taskRecordUserLabel({ nickname: null, username: "", email: "creator@example.com" }), "creator@example.com");
    assert.equal(taskRecordUserLabel({ nickname: null, username: "", email: null }), "—");
});
