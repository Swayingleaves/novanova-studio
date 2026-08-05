import assert from "node:assert/strict";
import test from "node:test";

import { formatGenerationStyleMessage, formatGroupedGenerationStyleMessage, getStyleCommandRange, parseGenerationStyleMessage, parseGroupedGenerationStyleMessage, removeStyleCommand } from "./style-command.ts";

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

test("复制的风格消息可以格式化并恢复风格与提示词", () => {
    const styles = [
        { id: 7, name: "电影感", generationType: "image" as const },
        { id: 8, name: "霓虹", generationType: "image" as const },
    ];
    const copied = formatGenerationStyleMessage("生成一张海报", styles);
    assert.equal(copied, "风格：电影感、霓虹\n生成一张海报");
    const parsed = parseGenerationStyleMessage(copied, styles);
    assert.equal(parsed?.prompt, "生成一张海报");
    assert.deepEqual(parsed?.styles.map((style) => style.id), [7, 8]);
});

test("复制消息中的未知风格不会静默删除风格文本", () => {
    const parsed = parseGenerationStyleMessage("风格：已停用风格\n生成一张海报", [{ id: 7, name: "电影感" }]);
    assert.equal(parsed, null);
});

test("画布 Agent 的混合风格消息按图片和视频分组恢复", () => {
    const styles = [
        { id: 7, name: "电影感", generationType: "image" as const },
        { id: 8, name: "胶片", generationType: "video" as const },
    ];
    const copied = formatGroupedGenerationStyleMessage("生成宣传素材", styles);
    assert.equal(copied, "图片风格：电影感\n视频风格：胶片\n生成宣传素材");
    const parsed = parseGroupedGenerationStyleMessage(copied, styles);
    assert.deepEqual(parsed?.styles.map((style) => style.id), [7, 8]);
    assert.equal(parsed?.prompt, "生成宣传素材");
});

test("画布 Agent 单类型风格兼容普通风格消息格式", () => {
    const style = { id: 7, name: "电影感", generationType: "image" as const };
    const copied = formatGroupedGenerationStyleMessage("生成海报", [style]);
    assert.equal(copied, "风格：电影感\n生成海报");
    const parsed = parseGenerationStyleMessage(copied, [style]);
    assert.equal(parsed?.styles[0].id, 7);
});
