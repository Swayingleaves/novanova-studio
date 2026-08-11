import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./app-config-modal.tsx", import.meta.url), "utf8");

test("图像和视频模型显示最小为1的整数同时并发数输入", () => {
    assert.match(source, /group\.capability === "image" \|\| group\.capability === "video"/);
    assert.match(source, /min=\{1\}/);
    assert.match(source, /precision=\{0\}/);
    assert.match(source, /requestConcurrency:\s*1/);
});

test("模型配置创建和更新请求都携带同时并发数", () => {
    assert.equal((source.match(/requestConcurrency: configItem\.requestConcurrency/g) || []).length, 2);
    assert.match(source, /first\.requestConcurrency === second\.requestConcurrency/);
});
