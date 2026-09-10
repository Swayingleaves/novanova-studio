import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./app-config-modal.tsx", import.meta.url), "utf8");

test("图像和视频模型显示最小为1的整数同时并发数输入", () => {
    assert.match(source, /editingModelConfig\.modelType === "image" \|\| editingModelConfig\.modelType === "video"/);
    assert.match(source, /min=\{1\}/);
    assert.match(source, /precision=\{0\}/);
    assert.match(source, /requestConcurrency:\s*1/);
});

test("模型配置创建和更新请求都携带同时并发数", () => {
    assert.equal((source.match(/requestConcurrency: normalizedConfig\.requestConcurrency/g) || []).length, 2);
    assert.match(source, /first\.requestConcurrency === second\.requestConcurrency/);
});

test("模型配置通过编辑弹窗维护自定义 JSON 参数", () => {
    assert.match(source, /openModelConfigEditor/);
    assert.match(source, /自定义 JSON/);
    assert.match(source, /JSON\.parse\(editingCustomBodyParameters/);
    assert.equal((source.match(/customBodyParameters: normalizedConfig\.customBodyParameters/g) || []).length, 2);
});

test("视频模型音频输入能力独立保存且受渠道和全能参考约束", () => {
    assert.match(source, /支持音频输入/);
    assert.match(source, /capabilities\.includes\("audio-input"\)/);
    assert.match(source, /capabilities\.includes\("reference-to-video"\)/);
    assert.match(source, /\["minimax", "evolink"\]\.includes/);
    assert.match(source, /mode !== "audio-input" && supportedCapabilities\.has\(mode\)/);
});
