import assert from "node:assert/strict";
import test from "node:test";

import { createImageNode, createStoryboardNode, createTextNode, createVideoNode, getCanvasNodeTemplate } from "./constants.ts";
import { MINIMUM_CONTENT_NODE_DIMENSION, nodeSizeFromRatioWithMinimum } from "./utils/canvas-node-size.ts";

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
    assert.deepEqual(first.frame, { position: { x: 10, y: 20 }, width: 600, height: 600 });
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
    assert.deepEqual(getCanvasNodeTemplate("image"), { title: "图像", width: 510, height: 360 });
    assert.deepEqual(getCanvasNodeTemplate("text"), { title: "文本", width: 600, height: 600 });
    assert.deepEqual(getCanvasNodeTemplate("video"), { title: "视频", width: 630, height: 354 });
    assert.deepEqual(getCanvasNodeTemplate("storyboard"), { title: "分镜脚本", width: 600, height: 600 });
});

test("文本和分镜节点按比例创建时保持比例且短边至少为500", () => {
    const portraitText = nodeSizeFromRatioWithMinimum("9:16", 600, 600, MINIMUM_CONTENT_NODE_DIMENSION);
    const landscapeStoryboard = nodeSizeFromRatioWithMinimum("16:9", 600, 600, MINIMUM_CONTENT_NODE_DIMENSION);

    assert.equal(portraitText?.width, 600);
    assert.equal(Math.round(portraitText?.height || 0), 1067);
    assert.equal(Math.round(landscapeStoryboard?.width || 0), 1067);
    assert.equal(landscapeStoryboard?.height, 600);
});
