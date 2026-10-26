import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./system-configuration.tsx", import.meta.url), "utf8");

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
    assert.match(source, /translate\("appShell\.customJSON"\)/);
    assert.match(source, /JSON\.parse\(editingCustomBodyParameters/);
    assert.equal((source.match(/customBodyParameters: normalizedConfig\.customBodyParameters/g) || []).length, 2);
});

test("视频模型音频输入能力由管理员配置且仅受全能参考约束", () => {
    assert.match(source, /translate\("appShell\.audioInputSupported"\)/);
    assert.match(source, /capabilities\.includes\("audio-input"\)/);
    assert.match(source, /capabilities\.includes\("reference-to-video"\)/);
    assert.doesNotMatch(source, /\["minimax", "evolink"\]\.includes/);
    assert.match(source, /disabled=\{isSaving \|\| !editingModelConfig\.capabilities\.includes\("audio-input"\) && !editingModelConfig\.capabilities\.includes\("reference-to-video"\)\}/);
    assert.match(source, /\{ label: "\{\{audioReferences\}\}", value: "\{\{audioReferences\}\}" \}/);
    assert.match(source, /mode !== "audio-input" && supportedCapabilities\.has\(mode\)/);
});

test("图片自定义能力支持同步异步切换，异步时复用视频的查询配置区", () => {
    assert.match(source, /<Segmented/);
    assert.match(source, /const imageAsync = !isVideo && current\.asyncQuery === true;/);
    // 同步态写 undefined，避免服务端不落键后被判定为有改动
    assert.match(source, /asyncQuery: value === "async" \? true : undefined/);
    assert.match(source, /\{isVideo \|\| imageAsync \? \(/);
    assert.match(source, /translate\(imageAsync \? "appShell\.resultPathTaskId" : "appShell\.resultPath"\)/);
});
