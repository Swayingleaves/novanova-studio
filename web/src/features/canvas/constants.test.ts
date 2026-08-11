import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode, createStoryboardNode, createTextNode, createVideoNode, getCanvasNodeTemplate } from "./constants.ts";

test("图片节点工厂每次返回独立的嵌套对象", () => {
    const first = createImageNode({ id: "image-1", position: { x: 0, y: 0 } });
    const second = createImageNode({ id: "image-2", position: { x: 0, y: 0 } });

    assert.notEqual(first.frame, second.frame);
    assert.notEqual(first.content, second.content);
    assert.notEqual(first.generation, second.generation);
    assert.notEqual(first.grouping, second.grouping);
    assert.equal(first.kind, "image");
    assert.equal(first.execution.phase, "idle");
});

test("文本节点工厂使用独立文本内容和默认字号", () => {
    const first = createTextNode({ id: "text-1", position: { x: 10, y: 20 }, text: "内容" });
    const second = createTextNode({ id: "text-2", position: { x: 10, y: 20 } });

    assert.notEqual(first.content, second.content);
    assert.deepEqual(first.content, { text: "内容", fontSize: 14 });
    assert.deepEqual(second.content, { text: "", fontSize: 14 });
});

test("视频节点工厂创建独立生成配置", () => {
    const first = createVideoNode({ id: "video-1", position: { x: 0, y: 0 } });
    const second = createVideoNode({ id: "video-2", position: { x: 0, y: 0 } });

    assert.notEqual(first.generation, second.generation);
    assert.notEqual(first.generation.references, second.generation.references);
    assert.equal(first.kind, "video");
});

test("分镜脚本节点保留独立的编辑数据与空执行状态", () => {
    const first = createStoryboardNode({ id: "storyboard-1", position: { x: 0, y: 0 } });
    const second = createStoryboardNode({ id: "storyboard-2", position: { x: 0, y: 0 } });

    assert.equal(first.kind, "storyboard");
    assert.deepEqual(first.content, { instruction: "", visualStyle: "", model: "" });
    assert.deepEqual(first.storyboard, { shots: [], assets: [] });
    assert.notEqual(first.storyboard, second.storyboard);
    assert.equal(first.execution.phase, "idle");
});

test("节点模板按类型返回固定尺寸", () => {
    assert.deepEqual(getCanvasNodeTemplate("image"), { title: "图像", width: 340, height: 240 });
    assert.deepEqual(getCanvasNodeTemplate("text"), { title: "文本", width: 340, height: 240 });
    assert.deepEqual(getCanvasNodeTemplate("video"), { title: "视频", width: 420, height: 236 });
    assert.deepEqual(getCanvasNodeTemplate("storyboard"), { title: "分镜脚本", width: 360, height: 380 });
});
