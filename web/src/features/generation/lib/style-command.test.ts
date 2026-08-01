import assert from "node:assert/strict";
import test from "node:test";

import { getStyleCommandRange, removeStyleCommand } from "./style-command.ts";

test("风格命令只在输入开头或空白后触发，并按光标位置筛选", () => {
    assert.deepEqual(getStyleCommandRange("/电影", 3), { start: 0, end: 3, query: "电影" });
    assert.deepEqual(getStyleCommandRange("一只猫 /赛博", 7), { start: 4, end: 7, query: "赛博" });
    assert.deepEqual(getStyleCommandRange("一只/猫", 4), null);
    assert.deepEqual(getStyleCommandRange("/电影 后续", 6), null);
});

test("选择风格后只移除当前斜杠命令，保留其他文本", () => {
    const value = "请生成 /电影 一只猫";
    const command = getStyleCommandRange(value, 7);
    assert.ok(command);
    assert.equal(removeStyleCommand(value, command.start, command.end), "请生成  一只猫");
});
